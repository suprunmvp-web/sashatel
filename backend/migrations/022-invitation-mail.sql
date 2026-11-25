
CREATE TABLE web_auth.invitation_mail_jobs (
 id uuid PRIMARY KEY,
 invitation_id uuid NOT NULL REFERENCES web_auth.staff_invitations(id),
 attempts integer NOT NULL DEFAULT 0,
 available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 completed_at timestamptz,
 lease_token uuid,
 lease_until timestamptz,
 delivery text NOT NULL DEFAULT 'queued'
  CHECK(delivery IN ('queued','accepted','failed','cancelled')),
 CHECK ((lease_token IS NULL)=(lease_until IS NULL))
);

CREATE INDEX invitation_mail_jobs_ready
 ON web_auth.invitation_mail_jobs(available_at,lease_until)
 WHERE completed_at IS NULL;

CREATE UNIQUE INDEX invitation_mail_jobs_pending
 ON web_auth.invitation_mail_jobs(invitation_id)
 WHERE completed_at IS NULL;

REVOKE ALL ON web_auth.invitation_mail_jobs
 FROM PUBLIC,control_runtime;

GRANT SELECT,UPDATE ON web_auth.invitation_mail_jobs
 TO control_runtime;

CREATE FUNCTION web_auth.queue_invitation_mail()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog AS $$
BEGIN
 INSERT INTO web_auth.invitation_mail_jobs(id,invitation_id)
 VALUES(NEW.id,NEW.id);
 RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION
 web_auth.queue_invitation_mail() FROM PUBLIC;

CREATE TRIGGER staff_invitation_mail
 AFTER INSERT ON web_auth.staff_invitations
 FOR EACH ROW EXECUTE FUNCTION web_auth.queue_invitation_mail();


CREATE FUNCTION web_auth.invitation_mail_details(invite_id uuid)
RETURNS jsonb
LANGUAGE sql SECURITY DEFINER
SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('email',i.email)
 FROM web_auth.staff_invitations i
 WHERE i.id=invite_id
 AND i.revoked_at IS NULL AND i.accepted_at IS NULL
 AND i.expires_at>clock_timestamp()
 AND web_auth.can_invite_staff(i.invited_by,i.organization_id)
$$;


CREATE FUNCTION web_auth.resend_staff_invitation(
 actor uuid,org_id uuid,invite_id uuid,job_id uuid
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog AS $$
DECLARE invitation web_auth.staff_invitations%ROWTYPE;
BEGIN
 IF NOT web_auth.can_invite_staff(actor,org_id) THEN
  RAISE EXCEPTION 'INVITATION_ACCESS_DENIED'
   USING ERRCODE='42501';
 END IF;

 SELECT * INTO invitation
 FROM web_auth.staff_invitations
 WHERE id=invite_id
 AND organization_id IS NOT DISTINCT FROM org_id
 FOR UPDATE;

 IF NOT FOUND THEN
  RAISE EXCEPTION 'RESOURCE_NOT_FOUND'
   USING ERRCODE='P0002';
 END IF;

 IF invitation.accepted_at IS NOT NULL
 OR invitation.revoked_at IS NOT NULL
 OR invitation.expires_at<=clock_timestamp()
 OR NOT web_auth.can_invite_staff(invitation.invited_by,org_id)
 THEN
  RAISE EXCEPTION 'INVITATION_UNAVAILABLE'
   USING ERRCODE='23514';
 END IF;

 IF EXISTS(
  SELECT 1 FROM web_auth.invitation_mail_jobs
  WHERE invitation_id=invite_id
  AND (completed_at IS NULL
   OR completed_at>clock_timestamp()-interval '60 seconds')
 ) THEN
  RETURN false;
 END IF;

 INSERT INTO web_auth.invitation_mail_jobs(id,invitation_id)
 VALUES(job_id,invite_id);

 RETURN true;
END $$;


CREATE FUNCTION web_auth.outgoing_staff_invitations(
 actor uuid,org_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 IF NOT web_auth.can_invite_staff(actor,org_id) THEN
  RAISE EXCEPTION 'INVITATION_ACCESS_DENIED'
   USING ERRCODE='42501';
 END IF;

 SELECT coalesce(jsonb_agg(to_jsonb(t)
  ORDER BY t.created_at DESC),'[]'::jsonb)
 INTO result
 FROM (
  SELECT i.id,i.email,i.role,i.created_at,i.expires_at,
   CASE
    WHEN i.accepted_at IS NOT NULL THEN 'accepted'
    WHEN i.revoked_at IS NOT NULL THEN 'revoked'
    WHEN i.expires_at<=clock_timestamp() THEN 'expired'
    WHEN NOT web_auth.can_invite_staff(i.invited_by,i.organization_id)
     THEN 'unavailable'
    ELSE 'pending'
   END AS status,
   coalesce(j.delivery,'not_queued') AS delivery
  FROM web_auth.staff_invitations i
  LEFT JOIN LATERAL (
   SELECT delivery FROM web_auth.invitation_mail_jobs
   WHERE invitation_id=i.id
   ORDER BY available_at DESC,id DESC LIMIT 1
  ) j ON true
  WHERE i.organization_id IS NOT DISTINCT FROM org_id
  ORDER BY i.created_at DESC,i.id
  LIMIT 200
 ) t;

 RETURN result;
END $$;

REVOKE ALL ON FUNCTION
 web_auth.invitation_mail_details(uuid),
 web_auth.resend_staff_invitation(uuid,uuid,uuid,uuid),
 web_auth.outgoing_staff_invitations(uuid,uuid)
 FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
 web_auth.invitation_mail_details(uuid),
 web_auth.resend_staff_invitation(uuid,uuid,uuid,uuid),
 web_auth.outgoing_staff_invitations(uuid,uuid)
 TO control_runtime;
