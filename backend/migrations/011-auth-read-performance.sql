-- Hardening v1: one account-scoped organization read, replacing per-org
-- RLS tenant switching / N+1 SQL roundtrips. Call only after WebAuth.identity().
-- Keep output exactly aligned with WebAuth.organization().
CREATE FUNCTION web_auth.account_organizations(account_id uuid)
RETURNS TABLE (
 id uuid, inn text, legal_name text, verification_status text,
 membership_id uuid, role text, status text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT o.id,o.inn,o.legal_name,o.verification_status,m.id,
   CASE WHEN o.owner_membership_id=m.id THEN 'owner' ELSE m.role_id END,
   CASE WHEN o.active THEN 'active' ELSE 'suspended' END
 FROM control.memberships m
 JOIN control.organizations o ON o.id=m.organization_id
 WHERE m.user_id=account_id AND m.active
 ORDER BY o.id
$$;
REVOKE ALL ON FUNCTION web_auth.account_organizations(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION web_auth.account_organizations(uuid) TO control_runtime;

-- Supporting indexes for the account's membership list and moderation queue.
-- Existing PK/UNIQUE indexes already cover browser/session token and INN lookups.
CREATE INDEX IF NOT EXISTS memberships_active_account_organizations
 ON control.memberships(user_id,organization_id) WHERE active;
CREATE INDEX IF NOT EXISTS organizations_pending_review
 ON control.organizations(id) WHERE verification_status='unverified';

-- The internal SashaTel owner is distinct from the customer organization owner.
-- Membership is provisioned only by an authorized DBA; never inferred from email.
ALTER TABLE web_auth.internal_staff
 DROP CONSTRAINT IF EXISTS internal_staff_role_check;
ALTER TABLE web_auth.internal_staff
 ADD CONSTRAINT internal_staff_role_check
 CHECK(role IN ('owner','admin','reviewer'));
