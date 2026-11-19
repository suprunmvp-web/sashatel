-- Incremental commercial Caller ID capacity. Does not modify pilot calls/outbox.
SET search_path=control,pg_catalog;

CREATE TABLE carousel_numbers (
 organization_id uuid NOT NULL,
 e164 text NOT NULL,
 trunk_id uuid NOT NULL,
 provider_approved boolean NOT NULL DEFAULT false,
 status text NOT NULL DEFAULT 'passive' CHECK (status IN ('active','passive')),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY (organization_id,e164),
 FOREIGN KEY (organization_id,e164) REFERENCES phone_numbers(organization_id,e164),
 FOREIGN KEY (organization_id,trunk_id) REFERENCES trunks(organization_id,id)
);
CREATE INDEX carousel_numbers_eligible ON carousel_numbers(organization_id,trunk_id,e164)
 WHERE status='active' AND provider_approved;

CREATE TABLE carousel_day_capacity (
 organization_id uuid NOT NULL,
 e164 text NOT NULL,
 day date NOT NULL,
 held integer NOT NULL DEFAULT 0 CHECK (held BETWEEN 0 AND 8),
 used integer NOT NULL DEFAULT 0 CHECK (used BETWEEN 0 AND 8),
 CHECK (held+used<=8),
 PRIMARY KEY (organization_id,e164,day),
 FOREIGN KEY (organization_id,e164) REFERENCES carousel_numbers(organization_id,e164)
);

CREATE TABLE carousel_dispatches (
 organization_id uuid NOT NULL REFERENCES organizations(id),
 id uuid NOT NULL,
 membership_id uuid NOT NULL,
 request_key text NOT NULL,
 destination text NOT NULL CHECK (destination ~ '^\\+[1-9][0-9]{6,14}$'),
 caller_id text NOT NULL,
 trunk_id uuid NOT NULL,
 budget_day date NOT NULL,
 state text NOT NULL CHECK (state IN ('held','committed','released','unknown')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL,
 committed_at timestamptz,
 PRIMARY KEY (organization_id,id),
 UNIQUE (organization_id,membership_id,request_key),
 FOREIGN KEY (organization_id,membership_id) REFERENCES memberships(organization_id,id),
 FOREIGN KEY (organization_id,caller_id) REFERENCES carousel_numbers(organization_id,e164),
 FOREIGN KEY (organization_id,trunk_id) REFERENCES trunks(organization_id,id)
);
CREATE INDEX carousel_expiry ON carousel_dispatches(organization_id,expires_at) WHERE state='held';

DO $$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['carousel_numbers','carousel_day_capacity','carousel_dispatches']
 LOOP
  EXECUTE format('ALTER TABLE control.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE control.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant ON control.%I USING (organization_id = nullif(current_setting(''control.tenant'',true),'''')::uuid)',t);
 END LOOP;
END $$;

GRANT SELECT ON carousel_numbers,carousel_day_capacity,carousel_dispatches TO control_runtime;
GRANT INSERT ON carousel_day_capacity,carousel_dispatches TO control_runtime;
GRANT UPDATE (held,used) ON carousel_day_capacity TO control_runtime;
GRANT UPDATE (state,committed_at) ON carousel_dispatches TO control_runtime;
-- Updating provider approval and active/passive is intentionally excluded from the runtime role.
