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

-- Paginated internal list, same security gate as the initial 200-item endpoint.
-- The extra row lets the API indicate there is another page without COUNT(*).
CREATE FUNCTION web_auth.internal_organizations_page(
 actor uuid, p_offset integer, p_limit integer
)
RETURNS TABLE (
 id uuid, inn text, legal_name text, legal_address text,
 verification_status text, active boolean, created_owner_email text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF p_offset<0 OR p_offset>100000 OR p_limit<1 OR p_limit>200 THEN
  RAISE EXCEPTION 'INVALID_PAGE' USING ERRCODE='22023';
 END IF;
 IF NOT EXISTS (
  SELECT 1 FROM web_auth.internal_staff s
  JOIN control.users u ON u.id=s.user_id
  WHERE s.user_id=actor AND s.active AND u.active AND u.email_verified_at IS NOT NULL
 ) THEN RAISE EXCEPTION 'INTERNAL_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 RETURN QUERY
 SELECT o.id,o.inn,o.legal_name,o.legal_address,o.verification_status,o.active,u.login
 FROM control.organizations o
 LEFT JOIN control.memberships m ON m.organization_id=o.id AND m.id=o.owner_membership_id
 LEFT JOIN control.users u ON u.id=m.user_id
 ORDER BY (o.verification_status='unverified') DESC,o.id
 LIMIT p_limit+1 OFFSET p_offset;
END $$;
REVOKE ALL ON FUNCTION web_auth.internal_organizations_page(uuid,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION web_auth.internal_organizations_page(uuid,integer,integer) TO control_runtime;
