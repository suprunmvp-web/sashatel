-- Organization default trunk and optional per-employee routing override.
-- A null organization default is allowed for organizations without a working trunk.
-- The call allocator may auto-select only when exactly one active trunk exists.
SET search_path=control,pg_catalog;

ALTER TABLE organizations ADD COLUMN default_trunk_id uuid;
ALTER TABLE memberships ADD COLUMN trunk_override_id uuid;

ALTER TABLE organizations ADD CONSTRAINT organizations_default_trunk_fk
  FOREIGN KEY (id,default_trunk_id) REFERENCES trunks(organization_id,id)
  DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE memberships ADD CONSTRAINT memberships_trunk_override_fk
  FOREIGN KEY (organization_id,trunk_override_id) REFERENCES trunks(organization_id,id)
  DEFERRABLE INITIALLY IMMEDIATE;

GRANT UPDATE (default_trunk_id) ON organizations TO control_runtime;
GRANT UPDATE (trunk_override_id) ON memberships TO control_runtime;

INSERT INTO role_permissions(role_id,permission) VALUES
  ('owner','trunks.manage'), ('admin','trunks.manage'),
  ('owner','cabinet'), ('admin','cabinet'),
  ('employee','call'), ('employee','operator.read')
  ON CONFLICT DO NOTHING;

-- No cross-tenant override can be stored due to composite foreign keys.
-- This migration does not enable live dispatch or alter provider credentials.
