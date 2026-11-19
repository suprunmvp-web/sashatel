SET search_path = control, pg_catalog;
INSERT INTO role_permissions VALUES ('organization_admin','trunks.manage');

CREATE TABLE managed_trunks (
  organization_id uuid,
  id uuid,
  membership_id uuid NOT NULL,
  request_key text NOT NULL,
  fingerprint text NOT NULL,
  name text NOT NULL,
  registrar_host text NOT NULL,
  registrar_port integer NOT NULL CHECK (registrar_port BETWEEN 1 AND 65535),
  generation integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'configuring' CHECK (status IN ('configuring','registering','registered','ready','rejected','degraded')),
  failure_code text CHECK (failure_code IN ('PROVISIONING_REJECTED','PROVISIONING_UNAVAILABLE')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz,
  PRIMARY KEY (organization_id,id),
  UNIQUE (organization_id,membership_id,request_key),
  FOREIGN KEY (organization_id,id) REFERENCES trunks,
  FOREIGN KEY (organization_id,membership_id) REFERENCES memberships
);
CREATE TABLE trunk_secrets (
  organization_id uuid,
  trunk_id uuid,
  envelope text NOT NULL,
  PRIMARY KEY (organization_id,trunk_id),
  FOREIGN KEY (organization_id,trunk_id) REFERENCES managed_trunks
);
CREATE TABLE trunk_jobs (
  organization_id uuid,
  trunk_id uuid,
  generation integer,
  operation text NOT NULL CHECK (operation IN ('UPSERT','REMOVE')),
  attempts integer NOT NULL DEFAULT 0,
  claim uuid,
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  PRIMARY KEY (organization_id,trunk_id,generation),
  FOREIGN KEY (organization_id,trunk_id) REFERENCES managed_trunks
);
DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['managed_trunks','trunk_secrets','trunk_jobs']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', name);
    EXECUTE format('CREATE POLICY tenant ON %I USING (organization_id = nullif(current_setting(''control.tenant'',true),'''')::uuid)', name);
  END LOOP;
END $$;
GRANT SELECT, INSERT ON managed_trunks,trunk_secrets,trunk_jobs TO control_runtime;
GRANT UPDATE (generation,status,failure_code,deleted_at) ON managed_trunks TO control_runtime;
GRANT UPDATE (attempts,claim,available_at,completed_at) ON trunk_jobs TO control_runtime;
GRANT DELETE ON trunk_secrets TO control_runtime;
GRANT INSERT ON trunks,audit_log TO control_runtime;
GRANT USAGE ON SEQUENCE audit_log_id_seq TO control_runtime;
