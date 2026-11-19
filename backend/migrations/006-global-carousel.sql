-- SashaTel v1.1: one physical Caller ID quota across all organizations.
-- Incremental to v1 routing migration; no PSTN dispatch enabled by schema.
SET search_path=control,pg_catalog;

CREATE TABLE carousel_numbers (
  organization_id uuid NOT NULL,
  e164 text NOT NULL CHECK(e164 ~ '^\+[1-9][0-9]{6,14}$'),
  trunk_id uuid NOT NULL,
  provider_approved boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'passive' CHECK(status IN('active','passive')),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(organization_id,e164),
  FOREIGN KEY(organization_id,e164) REFERENCES phone_numbers(organization_id,e164),
  FOREIGN KEY(organization_id,trunk_id) REFERENCES trunks(organization_id,id)
);
CREATE INDEX carousel_active ON carousel_numbers(organization_id,trunk_id,e164)
 WHERE provider_approved AND status='active';

-- v1.1 billing no longer reserves prepaid wallet units for a call.
-- Keep legacy reserved column for historical 001 rows; new calls use 0.
ALTER TABLE calls DROP CONSTRAINT calls_reserved_check;
ALTER TABLE calls ADD CONSTRAINT calls_reserved_nonnegative CHECK(reserved>=0);
ALTER TABLE calls ALTER COLUMN reserved SET DEFAULT 0;

-- Postpaid evidence in exact kopecks: 3 RUB per 60 human seconds = 5 kopecks/s.
-- Each business call settles once; corrections require a separately audited
-- adjustment workflow, not an overwrite of monetary evidence.
CREATE TABLE postpaid_usage (
 organization_id uuid NOT NULL,
 call_id uuid NOT NULL,
 outcome text NOT NULL CHECK(outcome IN('human','machine','no_answer','rejected','error','unknown')),
 billable_seconds integer NOT NULL CHECK(billable_seconds>=0),
 amount_kopeks bigint NOT NULL CHECK(amount_kopeks>=0),
 evidence_id text,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organization_id,call_id),
 FOREIGN KEY(organization_id,call_id) REFERENCES calls(organization_id,id),
 CHECK(
   (outcome='human' AND evidence_id IS NOT NULL AND length(evidence_id)>0
    AND amount_kopeks=billable_seconds::bigint*5)
   OR (outcome<>'human' AND billable_seconds=0 AND amount_kopeks=0)
 )
);
ALTER TABLE postpaid_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE postpaid_usage FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON postpaid_usage
 USING(organization_id=nullif(current_setting('control.tenant',true),'')::uuid);
GRANT SELECT,INSERT ON postpaid_usage TO control_runtime;

-- Billing owns this register, the call API can only read it. Amounts include
-- confirmed allocations of optional advances; unverified transfers must not
-- change paid_kopeks. The invoice issuer computes the contractual due_at,
-- including working-day/holiday rules and applicable legal requirements.
CREATE TABLE billing_obligations (
 organization_id uuid NOT NULL REFERENCES organizations(id),
 id uuid NOT NULL,
 issued_at timestamptz NOT NULL,
 due_at timestamptz NOT NULL,
 amount_kopeks bigint NOT NULL CHECK(amount_kopeks>0),
 paid_kopeks bigint NOT NULL DEFAULT 0 CHECK(paid_kopeks>=0),
 state text NOT NULL CHECK(state IN('issued','void')),
 PRIMARY KEY(organization_id,id),
 CHECK(due_at>issued_at),
 CHECK(paid_kopeks<=amount_kopeks)
);
ALTER TABLE billing_obligations ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_obligations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON billing_obligations
 USING(organization_id=nullif(current_setting('control.tenant',true),'')::uuid);
GRANT SELECT ON billing_obligations TO control_runtime;

-- This table MUST NOT be tenant-scoped: one real E.164 number, one daily quota.
-- It is not directly accessible to control_runtime; only guarded functions mutate it.
CREATE TABLE physical_caller_day (
  e164 text NOT NULL,
  day date NOT NULL,
  held integer NOT NULL DEFAULT 0 CHECK(held>=0),
  used integer NOT NULL DEFAULT 0 CHECK(used>=0),
  CHECK(held+used<=8),
  PRIMARY KEY(e164,day)
);

CREATE TABLE carousel_dispatches (
  organization_id uuid NOT NULL,
  id uuid NOT NULL,
  attempt_id uuid NOT NULL UNIQUE,
  membership_id uuid NOT NULL,
  request_key text NOT NULL,
  destination text NOT NULL CHECK(destination ~ '^\+[1-9][0-9]{6,14}$'),
  caller_id text NOT NULL,
  trunk_id uuid NOT NULL,
  budget_day date NOT NULL,
  state text NOT NULL DEFAULT 'held' CHECK(state IN('held','committed','released','unknown')),
  expires_at timestamptz NOT NULL DEFAULT (clock_timestamp()+interval '30 seconds'),
  committed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(organization_id,id),
  UNIQUE(organization_id,membership_id,request_key),
  FOREIGN KEY(organization_id,membership_id) REFERENCES memberships(organization_id,id),
  FOREIGN KEY(organization_id,caller_id) REFERENCES carousel_numbers(organization_id,e164),
  FOREIGN KEY(organization_id,trunk_id) REFERENCES trunks(organization_id,id)
);
CREATE INDEX carousel_dispatch_expiry ON carousel_dispatches(organization_id,expires_at) WHERE state='held';

CREATE TABLE carousel_outbox (
 organization_id uuid NOT NULL,
 dispatch_id uuid NOT NULL,
 attempt_id uuid NOT NULL,
 state text NOT NULL DEFAULT 'pending'
   CHECK(state IN('pending','claimed','unknown','completed')),
 claimed_at timestamptz,
 completed_at timestamptz,
 PRIMARY KEY(organization_id,dispatch_id),
 UNIQUE(attempt_id),
 FOREIGN KEY(organization_id,dispatch_id)
   REFERENCES carousel_dispatches(organization_id,id)
);

DO $$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['carousel_numbers','carousel_dispatches','carousel_outbox'] LOOP
  EXECUTE format('ALTER TABLE control.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE control.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant ON control.%I USING(organization_id=nullif(current_setting(''control.tenant'',true),'''')::uuid)',t);
 END LOOP;
END $$;

-- Read only the tenant's operator-approved numbers and their *global* load.
-- Using the physical counter for ordering prevents burning through one number
-- while other eligible numbers remain unused.
CREATE FUNCTION available_carousel_numbers(tenant uuid, effective_trunk uuid, budget_day date)
RETURNS TABLE(e164 text,trunk_id uuid,load integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=control,pg_catalog AS $$
BEGIN
 IF tenant IS DISTINCT FROM nullif(current_setting('control.tenant',true),'')::uuid THEN
  RAISE EXCEPTION 'TENANT_SCOPE_MISMATCH';
 END IF;
 RETURN QUERY
 SELECT n.e164,n.trunk_id,COALESCE(c.held+c.used,0)::integer
 FROM carousel_numbers n
 JOIN trunks t ON(t.organization_id,t.id)=(n.organization_id,n.trunk_id)
 LEFT JOIN physical_caller_day c ON c.e164=n.e164 AND c.day=budget_day
 WHERE n.organization_id=tenant AND n.trunk_id=effective_trunk
   AND n.status='active' AND n.provider_approved AND t.active
 ORDER BY COALESCE(c.held+c.used,0),n.e164;
END $$;

-- Hold the physical quota under a PostgreSQL row lock; fail closed at the ninth slot.
-- The service invokes this in its own transaction after session authorization.
CREATE FUNCTION hold_physical_caller(tenant uuid, phone text, budget_day date)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path=control,pg_catalog AS $$
DECLARE accepted integer;
BEGIN
 IF tenant IS DISTINCT FROM nullif(current_setting('control.tenant',true),'')::uuid THEN
  RAISE EXCEPTION 'TENANT_SCOPE_MISMATCH';
 END IF;
 IF NOT EXISTS (
  SELECT 1 FROM carousel_numbers n JOIN trunks t
    ON(t.organization_id,t.id)=(n.organization_id,n.trunk_id)
   WHERE n.organization_id=tenant AND n.e164=phone AND n.status='active'
     AND n.provider_approved AND t.active
 ) THEN
  RAISE EXCEPTION 'CALLER_NOT_APPROVED';
 END IF;
 INSERT INTO physical_caller_day(e164,day,held,used) VALUES(phone,budget_day,1,0)
 ON CONFLICT(e164,day) DO UPDATE
   SET held=physical_caller_day.held+1
   WHERE physical_caller_day.held+physical_caller_day.used<8
 RETURNING held INTO accepted;
 RETURN accepted IS NOT NULL;
END $$;

-- Finalizing a tenant-owned dispatch also finalizes its global quota in one transaction.
-- Never release a committed attempt, including after uncertain ARI originate.
CREATE FUNCTION finalize_physical_caller(tenant uuid, dispatch_id uuid, action text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path=control,pg_catalog AS $$
DECLARE h carousel_dispatches%ROWTYPE;
DECLARE current_day date;
BEGIN
 IF tenant IS DISTINCT FROM nullif(current_setting('control.tenant',true),'')::uuid THEN
  RAISE EXCEPTION 'TENANT_SCOPE_MISMATCH';
 END IF;
 IF action NOT IN('commit','release') THEN RAISE EXCEPTION 'INVALID_FINALIZE_ACTION'; END IF;
 SELECT * INTO h FROM carousel_dispatches
  WHERE organization_id=tenant AND id=dispatch_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'UNKNOWN_DISPATCH'; END IF;
 IF h.state <> 'held' THEN RETURN h.state; END IF;
 IF action='commit' THEN
  current_day := (clock_timestamp() AT TIME ZONE 'Europe/Moscow')::date;
  IF h.expires_at<=clock_timestamp() OR h.budget_day<>current_day THEN
   RAISE EXCEPTION 'HOLD_EXPIRED_OR_DAY_CHANGED';
  END IF;
  IF NOT EXISTS (
   SELECT 1 FROM carousel_numbers n JOIN trunks t
     ON (t.organization_id,t.id)=(n.organization_id,n.trunk_id)
    WHERE n.organization_id=tenant AND n.e164=h.caller_id
      AND n.trunk_id=h.trunk_id AND n.status='active'
      AND n.provider_approved AND t.active
  ) THEN RAISE EXCEPTION 'CALLER_NOT_APPROVED'; END IF;
  UPDATE physical_caller_day SET held=held-1,used=used+1
   WHERE e164=h.caller_id AND day=h.budget_day AND held>0;
  IF NOT FOUND THEN RAISE EXCEPTION 'PHYSICAL_HOLD_MISSING'; END IF;
  UPDATE carousel_dispatches SET state='committed',committed_at=clock_timestamp()
    WHERE organization_id=tenant AND id=dispatch_id;
  -- Persist the one-shot command together with the quota commit.
  INSERT INTO carousel_outbox(organization_id,dispatch_id,attempt_id)
    VALUES(tenant,dispatch_id,h.attempt_id);
  RETURN 'committed';
 END IF;
 UPDATE physical_caller_day SET held=held-1
  WHERE e164=h.caller_id AND day=h.budget_day AND held>0;
 IF NOT FOUND THEN RAISE EXCEPTION 'PHYSICAL_HOLD_MISSING'; END IF;
 UPDATE carousel_dispatches SET state='released'
  WHERE organization_id=tenant AND id=dispatch_id;
 RETURN 'released';
END $$;

-- Expired holds must be reclaimed by the DB authority, not by granting
-- the HTTP runtime UPDATE access to dispatch or global quota tables.
CREATE FUNCTION expire_physical_holds(tenant uuid, max_batch integer DEFAULT 100)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path=control,pg_catalog AS $$
DECLARE h carousel_dispatches%ROWTYPE;
DECLARE released integer:=0;
BEGIN
 IF tenant IS DISTINCT FROM nullif(current_setting('control.tenant',true),'')::uuid THEN
  RAISE EXCEPTION 'TENANT_SCOPE_MISMATCH';
 END IF;
 IF max_batch<1 OR max_batch>500 THEN RAISE EXCEPTION 'INVALID_EXPIRY_BATCH'; END IF;
 FOR h IN
   SELECT * FROM carousel_dispatches
   WHERE organization_id=tenant AND state='held' AND expires_at<=clock_timestamp()
   ORDER BY expires_at,id FOR UPDATE SKIP LOCKED LIMIT max_batch
 LOOP
   UPDATE physical_caller_day SET held=held-1
     WHERE e164=h.caller_id AND day=h.budget_day AND held>0;
   IF NOT FOUND THEN RAISE EXCEPTION 'PHYSICAL_HOLD_MISSING'; END IF;
   UPDATE carousel_dispatches SET state='released'
     WHERE organization_id=tenant AND id=h.id;
   released:=released+1;
 END LOOP;
 RETURN released;
END $$;

REVOKE ALL ON FUNCTION expire_physical_holds(uuid,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION available_carousel_numbers(uuid,uuid,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION hold_physical_caller(uuid,text,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION finalize_physical_caller(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION expire_physical_holds(uuid,integer),
  available_carousel_numbers(uuid,uuid,date),
  hold_physical_caller(uuid,text,date),
  finalize_physical_caller(uuid,uuid,text) TO control_runtime;
GRANT SELECT ON carousel_numbers,carousel_dispatches,carousel_outbox TO control_runtime;
GRANT UPDATE (state,claimed_at,completed_at) ON carousel_outbox TO control_runtime;
GRANT INSERT ON carousel_dispatches TO control_runtime;
-- Operator approval and active/passive transitions require a separate trusted service.
-- No direct DML privilege on physical_caller_day for application runtime.
