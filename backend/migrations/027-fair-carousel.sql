SET search_path=control,pg_catalog;

-- Global rotation metadata, inaccessible to application runtime.
CREATE TABLE physical_caller_rotation (
 e164 text PRIMARY KEY,
 last_initiated_at timestamptz NOT NULL
);

REVOKE ALL ON physical_caller_rotation
 FROM PUBLIC,control_runtime;

-- Migration runs transactionally as the schema owner.
-- Include every tenant in the historical backfill.
ALTER TABLE carousel_dispatches NO FORCE ROW LEVEL SECURITY;

INSERT INTO physical_caller_rotation(e164,last_initiated_at)
SELECT caller_id,max(committed_at)
FROM carousel_dispatches
WHERE committed_at IS NOT NULL
GROUP BY caller_id;

ALTER TABLE carousel_dispatches FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION available_carousel_numbers(tenant uuid, effective_trunk uuid, budget_day date)
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
 LEFT JOIN physical_caller_rotation rotation
  ON rotation.e164=n.e164
 WHERE n.organization_id=tenant AND n.trunk_id=effective_trunk
   AND n.status='active' AND n.provider_approved AND t.active
 ORDER BY COALESCE(c.held+c.used,0),
   rotation.last_initiated_at ASC NULLS FIRST,
   n.e164;
END $$;

CREATE OR REPLACE FUNCTION finalize_physical_caller(tenant uuid, dispatch_id uuid, action text)
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
 PERFORM pg_advisory_xact_lock(1935766117,28);

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
  INSERT INTO physical_caller_rotation(
   e164,last_initiated_at
  ) VALUES(h.caller_id,clock_timestamp())
  ON CONFLICT(e164) DO UPDATE
   SET last_initiated_at=GREATEST(
    physical_caller_rotation.last_initiated_at,
    EXCLUDED.last_initiated_at
   );

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


CREATE OR REPLACE FUNCTION hold_physical_caller(tenant uuid, phone text, budget_day date)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path=control,pg_catalog AS $$
DECLARE accepted integer;
BEGIN
 IF tenant IS DISTINCT FROM nullif(current_setting('control.tenant',true),'')::uuid THEN
  RAISE EXCEPTION 'TENANT_SCOPE_MISMATCH';
 END IF;
 PERFORM pg_advisory_xact_lock(1935766117,28);

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


CREATE OR REPLACE FUNCTION expire_physical_holds(tenant uuid, max_batch integer DEFAULT 100)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path=control,pg_catalog AS $$
DECLARE h carousel_dispatches%ROWTYPE;
DECLARE released integer:=0;
BEGIN
 IF tenant IS DISTINCT FROM nullif(current_setting('control.tenant',true),'')::uuid THEN
  RAISE EXCEPTION 'TENANT_SCOPE_MISMATCH';
 END IF;
 PERFORM pg_advisory_xact_lock(1935766117,28);

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
   UPDATE calls SET state='expired'
     WHERE organization_id=tenant AND id=h.id AND state='authorized';
   released:=released+1;
 END LOOP;
 RETURN released;
END $$;
