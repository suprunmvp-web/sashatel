CREATE SCHEMA control;
SET search_path = control, pg_catalog;

CREATE TABLE organizations (
  id uuid PRIMARY KEY,
  active boolean NOT NULL DEFAULT true,
  max_calls integer NOT NULL CHECK (max_calls > 0)
);
CREATE TABLE users (
  id uuid PRIMARY KEY,
  login text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  phone_epoch bigint NOT NULL DEFAULT 0
);
CREATE TABLE roles (id text PRIMARY KEY);
INSERT INTO roles VALUES ('manager'), ('supervisor'), ('organization_admin'), ('superadmin');
CREATE TABLE role_permissions (
  role_id text REFERENCES roles,
  permission text,
  PRIMARY KEY (role_id, permission)
);
INSERT INTO role_permissions VALUES
  ('manager','call'), ('supervisor','call'), ('supervisor','cabinet'),
  ('organization_admin','cabinet'), ('superadmin','cabinet');

CREATE TABLE memberships (
  organization_id uuid REFERENCES organizations,
  id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users,
  role_id text NOT NULL REFERENCES roles,
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (organization_id,id),
  UNIQUE (organization_id,user_id)
);
CREATE TABLE devices (
  organization_id uuid,
  id uuid,
  membership_id uuid NOT NULL,
  PRIMARY KEY (organization_id,id),
  UNIQUE (organization_id,id,membership_id),
  FOREIGN KEY (organization_id,membership_id) REFERENCES memberships
);
CREATE TABLE sessions (
  organization_id uuid,
  token_hash text,
  membership_id uuid NOT NULL,
  device_id uuid NOT NULL,
  phone_epoch bigint NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  PRIMARY KEY (organization_id,token_hash),
  FOREIGN KEY (organization_id,device_id,membership_id) REFERENCES devices (organization_id,id,membership_id)
);
CREATE TABLE subscriptions (
  organization_id uuid PRIMARY KEY REFERENCES organizations,
  active boolean NOT NULL,
  telephony boolean NOT NULL
);
CREATE TABLE wallets (
  organization_id uuid PRIMARY KEY REFERENCES organizations,
  mode text NOT NULL CHECK (mode IN ('minutes','prepaid','credit')),
  available bigint NOT NULL CHECK (available >= 0),
  reserve_per_call bigint NOT NULL CHECK (reserve_per_call > 0)
);
CREATE TABLE trunks (
  organization_id uuid REFERENCES organizations,
  id uuid,
  active boolean NOT NULL,
  PRIMARY KEY (organization_id,id)
);
CREATE TABLE phone_numbers (
  organization_id uuid REFERENCES organizations,
  e164 text CHECK (e164 ~ '^\+[1-9][0-9]{6,14}$'),
  trunk_id uuid NOT NULL,
  active boolean NOT NULL,
  PRIMARY KEY (organization_id,e164),
  FOREIGN KEY (organization_id,trunk_id) REFERENCES trunks
);
CREATE TABLE number_attempts (
  e164 text NOT NULL,
  day date NOT NULL,
  used integer NOT NULL CHECK (used BETWEEN 1 AND 8),
  PRIMARY KEY (e164, day)
);
CREATE TABLE calls (
  organization_id uuid,
  id uuid,
  attempt_id uuid NOT NULL UNIQUE,
  membership_id uuid NOT NULL,
  session_hash text NOT NULL,
  request_key text NOT NULL,
  destination text NOT NULL,
  caller_id text NOT NULL,
  trunk_id uuid NOT NULL,
  reserved bigint NOT NULL CHECK (reserved > 0),
  state text NOT NULL CHECK (state IN ('authorized','dispatching','reconciling','ringing','connected','terminating','ended','failed','expired')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id,id),
  UNIQUE (organization_id,membership_id,request_key),
  FOREIGN KEY (organization_id,membership_id) REFERENCES memberships,
  FOREIGN KEY (organization_id,session_hash) REFERENCES sessions,
  FOREIGN KEY (organization_id,caller_id) REFERENCES phone_numbers,
  FOREIGN KEY (organization_id,trunk_id) REFERENCES trunks
);
CREATE TABLE usage_ledger (
  organization_id uuid,
  call_id uuid,
  kind text CHECK (kind IN ('reserve','charge','release')),
  units bigint NOT NULL CHECK (units >= 0),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (organization_id,call_id,kind),
  FOREIGN KEY (organization_id,call_id) REFERENCES calls
);
CREATE TABLE outbox (
  organization_id uuid,
  call_id uuid,
  command text CHECK (command IN ('originate','hangup')),
  claimed_at timestamptz,
  completed_at timestamptz,
  PRIMARY KEY (organization_id,call_id,command),
  FOREIGN KEY (organization_id,call_id) REFERENCES calls
);
CREATE TABLE call_events (
  organization_id uuid,
  call_id uuid,
  event_id text,
  state text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (organization_id,call_id,event_id),
  FOREIGN KEY (organization_id,call_id) REFERENCES calls
);
CREATE TABLE audit_log (
  organization_id uuid REFERENCES organizations,
  id bigint GENERATED ALWAYS AS IDENTITY,
  actor_id uuid REFERENCES users,
  action text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (organization_id,id)
);

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON organizations USING (id = nullif(current_setting('control.tenant', true),'')::uuid);

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['memberships','devices','sessions','subscriptions','wallets','trunks','phone_numbers','calls','usage_ledger','outbox','call_events','audit_log']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY tenant ON %I USING (organization_id = nullif(current_setting(''control.tenant'',true),'''')::uuid)', table_name);
  END LOOP;
END $$;
