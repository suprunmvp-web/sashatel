
ALTER TABLE web_auth.organization_reviews
 DROP CONSTRAINT organization_reviews_outcome_check;

ALTER TABLE web_auth.organization_reviews
 ADD CONSTRAINT organization_reviews_outcome_check
 CHECK(outcome IN ('verified','rejected','reopened','revoked'));

CREATE FUNCTION web_auth.revoke_organization_verification(
 actor uuid, org_id uuid, evidence text,
 explanation text, review_id uuid
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog AS $$
DECLARE current_inn text; current_status text;
BEGIN
 PERFORM 1 FROM web_auth.internal_staff s
 JOIN control.users u ON u.id=s.user_id
 WHERE s.user_id=actor AND s.active
 AND u.active AND u.email_verified_at IS NOT NULL
 AND s.role IN ('owner','admin','manager')
 FOR SHARE OF s;

 IF NOT FOUND THEN
  RAISE EXCEPTION 'INTERNAL_ACCESS_DENIED' USING ERRCODE='42501';
 END IF;

 IF evidence IS NULL OR explanation IS NULL OR
    length(trim(evidence))<5 OR length(trim(explanation))<8 OR
    length(evidence)>500 OR length(explanation)>2000
 THEN
  RAISE EXCEPTION 'INVALID_REVIEW' USING ERRCODE='22023';
 END IF;

 SELECT o.inn INTO current_inn
 FROM control.organizations o WHERE o.id=org_id;

 IF NOT FOUND THEN
  RAISE EXCEPTION 'ORGANIZATION_NOT_FOUND' USING ERRCODE='P0002';
 END IF;

 PERFORM pg_advisory_xact_lock(hashtextextended(current_inn,0));

 SELECT o.verification_status INTO current_status
 FROM control.organizations o
 WHERE o.id=org_id FOR UPDATE;

 IF NOT FOUND THEN
  RAISE EXCEPTION 'ORGANIZATION_NOT_FOUND' USING ERRCODE='P0002';
 END IF;

 IF current_status<>'verified' THEN
  RAISE EXCEPTION 'REVOCATION_REQUIRES_VERIFIED'
   USING ERRCODE='23514';
 END IF;

 UPDATE control.organizations
 SET verification_status='unverified'
 WHERE id=org_id;

 INSERT INTO web_auth.organization_reviews
 (id,organization_id,reviewer_user_id,outcome,evidence_reference,explanation)
 VALUES(review_id,org_id,actor,'revoked',evidence,explanation);

 RETURN 'unverified';
END $$;

REVOKE ALL ON FUNCTION
 web_auth.revoke_organization_verification(uuid,uuid,text,text,uuid)
 FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
 web_auth.revoke_organization_verification(uuid,uuid,text,text,uuid)
 TO control_runtime;
