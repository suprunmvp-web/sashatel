ALTER TABLE control.sessions ADD COLUMN operator_observed_at_ms bigint NOT NULL DEFAULT 0;
GRANT UPDATE (operator_observed_at_ms) ON control.sessions TO control_runtime;
INSERT INTO control.role_permissions VALUES
  ('manager','operator.read'), ('supervisor','operator.read');
