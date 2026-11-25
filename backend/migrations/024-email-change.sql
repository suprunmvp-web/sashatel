CREATE TABLE web_auth.email_changes (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES control.users(id),
 browser_hash text NOT NULL REFERENCES web_auth.browsers(hash),
 family_id uuid NOT NULL REFERENCES web_auth.families(id),
 old_email text NOT NULL,
 email text NOT NULL,
 password_fingerprint text NOT NULL,
 code_hash text NOT NULL,
 expires_at timestamptz NOT NULL,
 attempts integer NOT NULL DEFAULT 0
  CHECK(attempts BETWEEN 0 AND 5),
 consumed_at timestamptz
);

CREATE UNIQUE INDEX email_changes_live_user
 ON web_auth.email_changes(user_id)
 WHERE consumed_at IS NULL;

CREATE TABLE web_auth.email_change_mail_jobs (
 reset_id uuid PRIMARY KEY REFERENCES web_auth.email_changes(id),
 envelope text,
 attempts integer NOT NULL DEFAULT 0,
 available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 completed_at timestamptz,
 lease_token uuid,
 lease_until timestamptz,
 CHECK((lease_token IS NULL)=(lease_until IS NULL))
);

CREATE INDEX email_change_mail_ready
 ON web_auth.email_change_mail_jobs(available_at,lease_until)
 WHERE completed_at IS NULL;

GRANT SELECT,INSERT,UPDATE ON
 web_auth.email_changes,
 web_auth.email_change_mail_jobs
 TO control_runtime;

CREATE FUNCTION web_auth.apply_email_change(
 actor uuid,change_id uuid,proof text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog AS $$
DECLARE request web_auth.email_changes%ROWTYPE;
BEGIN
 SELECT * INTO request
 FROM web_auth.email_changes
 WHERE id=change_id AND user_id=actor
 AND code_hash=encode(sha256(convert_to(proof,'UTF8')),'hex')
 AND attempts<5
 AND consumed_at IS NULL
 AND expires_at>clock_timestamp()
 FOR UPDATE;

 IF NOT FOUND THEN
  RAISE EXCEPTION 'EMAIL_CHANGE_UNAVAILABLE'
   USING ERRCODE='23514';
 END IF;

 IF EXISTS(
  SELECT 1 FROM web_auth.internal_staff
  WHERE user_id=actor AND protected_owner
 ) THEN
  RAISE EXCEPTION 'PROTECTED_OWNER'
   USING ERRCODE='42501';
 END IF;

 UPDATE control.users
 SET login=request.email,
     email_verified_at=clock_timestamp()
 WHERE id=actor AND active
 AND lower(login)=request.old_email;

 IF NOT FOUND THEN
  RAISE EXCEPTION 'EMAIL_CHANGE_UNAVAILABLE'
   USING ERRCODE='23514';
 END IF;

 UPDATE web_auth.email_changes
 SET consumed_at=clock_timestamp()
 WHERE id=change_id;

 UPDATE web_auth.families
 SET revoked_at=COALESCE(revoked_at,clock_timestamp())
 WHERE user_id=actor;

 UPDATE control.sessions s
 SET revoked_at=clock_timestamp()
 FROM control.memberships m
 WHERE s.organization_id=m.organization_id
 AND s.membership_id=m.id
 AND m.user_id=actor
 AND s.revoked_at IS NULL;

 UPDATE web_auth.browsers
 SET completion=NULL,
     completion_family=NULL,
     completion_expires=NULL
 WHERE hash IN (
  SELECT browser_hash FROM web_auth.families
  WHERE user_id=actor
 );

 UPDATE web_auth.password_resets
 SET consumed_at=clock_timestamp(),reset_hash=NULL
 WHERE user_id=actor AND consumed_at IS NULL;
END $$;

REVOKE ALL ON FUNCTION
 web_auth.apply_email_change(uuid,uuid,text)
 FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
 web_auth.apply_email_change(uuid,uuid,text)
 TO control_runtime;

CREATE FUNCTION web_auth.is_protected_owner(actor uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog AS $$
 SELECT EXISTS(
  SELECT 1 FROM web_auth.internal_staff
  WHERE user_id=actor AND protected_owner
 );
$$;

REVOKE ALL ON FUNCTION
 web_auth.is_protected_owner(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
 web_auth.is_protected_owner(uuid) TO control_runtime;
