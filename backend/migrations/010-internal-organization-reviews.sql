-- Separate SashaTel staff from customer organizations. No browser, email domain or
-- customer membership grants internal privileges. Provision staff via DBA approval only.
CREATE TABLE web_auth.internal_staff (
 user_id uuid PRIMARY KEY REFERENCES control.users(id),
 role text NOT NULL CHECK(role IN ('admin','reviewer')),
 active boolean NOT NULL DEFAULT true,
 granted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON web_auth.internal_staff FROM PUBLIC;

-- Explicit history of decisions, including the evidence reference checked by staff.
CREATE TABLE web_auth.organization_reviews (
 id uuid PRIMARY KEY,
 organization_id uuid NOT NULL REFERENCES control.organizations(id),
 reviewer_user_id uuid NOT NULL REFERENCES control.users(id),
 outcome text NOT NULL CHECK(outcome IN ('verified','rejected')),
 evidence_reference text NOT NULL,
 explanation text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON web_auth.organization_reviews FROM PUBLIC;
CREATE INDEX organization_reviews_org_idx
 ON web_auth.organization_reviews(organization_id,recorded_at DESC);

-- Remove the old global uniqueness constraint; preserve a DB-enforced invariant
-- preventing more than one verified organization per INN under concurrent reviews.
DO $$
DECLARE unique_name text;
BEGIN
 SELECT c.conname INTO unique_name
 FROM pg_constraint c
 JOIN pg_class t ON t.oid=c.conrelid
 JOIN pg_namespace n ON n.oid=t.relnamespace
 WHERE n.nspname='control' AND t.relname='organizations'
   AND c.contype='u'
   AND (SELECT array_agg(a.attname ORDER BY a.attnum)
        FROM unnest(c.conkey) AS keys(attnum)
        JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=keys.attnum)
       = ARRAY['inn']::name[];
 IF unique_name IS NOT NULL THEN
   EXECUTE format('ALTER TABLE control.organizations DROP CONSTRAINT %I',unique_name);
 END IF;
END $$;
CREATE UNIQUE INDEX organizations_verified_inn_unique
 ON control.organizations(inn)
 WHERE verification_status='verified' AND inn IS NOT NULL;
ALTER TABLE control.organizations DROP CONSTRAINT IF EXISTS organizations_verification_status_check;
ALTER TABLE control.organizations ADD CONSTRAINT organizations_verification_status_check
 CHECK (verification_status IN ('unverified','verified','rejected'));

-- A privileged function only reveals the *minimum* administrative dataset after
-- confirming a verified server-side user ID against DBA-maintained staff records.
CREATE FUNCTION web_auth.internal_organizations(actor uuid)
RETURNS TABLE(id uuid, inn text, legal_name text, legal_address text,
 verification_status text, active boolean, created_owner_email text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM web_auth.internal_staff s
   JOIN control.users u ON u.id=s.user_id
   WHERE s.user_id=actor AND s.active AND u.active
     AND u.email_verified_at IS NOT NULL)
 THEN RAISE EXCEPTION 'INTERNAL_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 RETURN QUERY
 SELECT o.id,o.inn,o.legal_name,o.legal_address,o.verification_status,
        o.active,u.login
 FROM control.organizations o
 LEFT JOIN control.memberships m ON m.organization_id=o.id
   AND m.id=o.owner_membership_id
 LEFT JOIN control.users u ON u.id=m.user_id
 ORDER BY (o.verification_status='unverified') DESC,o.id
 LIMIT 200;
END $$;
REVOKE ALL ON FUNCTION web_auth.internal_organizations(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION web_auth.internal_organizations(uuid) TO control_runtime;

-- All review actions are serialized by INN and audited atomically in PostgreSQL.
-- No review changes subscription.telephony or authorizes dialing.
CREATE FUNCTION web_auth.review_organization(
 actor uuid, org_id uuid, decision text,
 evidence text, explanation text, review_id uuid
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE current_inn text; current_status text;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM web_auth.internal_staff s
   JOIN control.users u ON u.id=s.user_id
   WHERE s.user_id=actor AND s.active AND u.active
     AND u.email_verified_at IS NOT NULL)
 THEN RAISE EXCEPTION 'INTERNAL_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 IF decision NOT IN ('verified','rejected') OR
    length(trim(evidence))<5 OR length(trim(explanation))<8 OR
    length(evidence)>500 OR length(explanation)>2000
 THEN RAISE EXCEPTION 'INVALID_REVIEW' USING ERRCODE='22023'; END IF;

 SELECT o.inn INTO current_inn FROM control.organizations o WHERE o.id=org_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'ORGANIZATION_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(current_inn,0));
 SELECT o.verification_status INTO current_status FROM control.organizations o
 WHERE o.id=org_id FOR UPDATE;
 IF current_status<>'unverified' THEN
  RAISE EXCEPTION 'ALREADY_REVIEWED' USING ERRCODE='23514';
 END IF;
 UPDATE control.organizations SET verification_status=decision WHERE id=org_id;
 INSERT INTO web_auth.organization_reviews
  (id,organization_id,reviewer_user_id,outcome,evidence_reference,explanation)
 VALUES (review_id,org_id,actor,decision,evidence,explanation);
 RETURN decision;
END $$;
REVOKE ALL ON FUNCTION web_auth.review_organization(uuid,uuid,text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION web_auth.review_organization(uuid,uuid,text,text,text,uuid) TO control_runtime;

-- No direct staff membership or cross-tenant write privileges to the runtime role.
