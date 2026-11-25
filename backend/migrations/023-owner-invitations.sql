
ALTER TABLE web_auth.staff_invitations
 DROP CONSTRAINT staff_invitations_role_check;

ALTER TABLE web_auth.staff_invitations
 ADD CONSTRAINT staff_invitations_role_check
 CHECK(
  role IN ('admin','manager')
  OR (role='owner' AND organization_id IS NOT NULL)
 );

CREATE UNIQUE INDEX staff_invitations_single_owner
 ON web_auth.staff_invitations(organization_id)
 WHERE role='owner'
 AND accepted_at IS NULL AND revoked_at IS NULL;


CREATE FUNCTION web_auth.can_invite_initial_owner(
 actor uuid,org_id uuid
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog SET control.tenant='' AS $$
BEGIN
 IF org_id IS NULL OR
 coalesce(web_auth.internal_staff_role(actor),'')
 NOT IN ('owner','admin') THEN
  RETURN false;
 END IF;

 PERFORM set_config('control.tenant',org_id::text,true);

 RETURN EXISTS(
  SELECT 1 FROM control.organizations
  WHERE id=org_id AND active AND owner_membership_id IS NULL
 )
 AND NOT EXISTS(
  SELECT 1 FROM control.memberships
  WHERE organization_id=org_id AND role_id='owner'
 );
END $$;

REVOKE ALL ON FUNCTION
 web_auth.can_invite_initial_owner(uuid,uuid) FROM PUBLIC;


CREATE FUNCTION web_auth.invitation_authorized(
 actor uuid,org_id uuid,invite_role text
) RETURNS boolean
LANGUAGE sql SECURITY DEFINER
SET search_path=pg_catalog AS $$
 SELECT CASE WHEN invite_role='owner'
  THEN web_auth.can_invite_initial_owner(actor,org_id)
  ELSE web_auth.can_invite_staff(actor,org_id)
 END
$$;

REVOKE ALL ON FUNCTION
 web_auth.invitation_authorized(uuid,uuid,text) FROM PUBLIC;


CREATE FUNCTION web_auth.create_initial_owner_invitation(
 actor uuid,org_id uuid,invite_id uuid,invite_email text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog SET control.tenant='' AS $$
DECLARE existing record;
BEGIN
 IF NOT web_auth.can_invite_initial_owner(actor,org_id) THEN
  RAISE EXCEPTION 'INVITATION_ACCESS_DENIED'
   USING ERRCODE='42501';
 END IF;

 IF invite_email IS NULL OR length(invite_email)>254
 OR invite_email<>lower(trim(invite_email))
 OR invite_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
 THEN
  RAISE EXCEPTION 'INVALID_INVITATION'
   USING ERRCODE='22023';
 END IF;

 PERFORM set_config('control.tenant',org_id::text,true);

 PERFORM 1 FROM control.organizations
 WHERE id=org_id FOR UPDATE;

 IF NOT web_auth.can_invite_initial_owner(actor,org_id) THEN
  RAISE EXCEPTION 'INVITATION_ACCESS_DENIED'
   USING ERRCODE='42501';
 END IF;

 IF EXISTS(
  SELECT 1 FROM control.memberships m
  JOIN control.users u ON u.id=m.user_id
  WHERE m.organization_id=org_id
  AND lower(u.login)=invite_email
 ) THEN
  RAISE EXCEPTION 'STAFF_ALREADY_EXISTS'
   USING ERRCODE='23505';
 END IF;

 UPDATE web_auth.staff_invitations
 SET revoked_at=clock_timestamp()
 WHERE organization_id=org_id AND role='owner'
 AND accepted_at IS NULL AND revoked_at IS NULL
 AND expires_at<=clock_timestamp();

 SELECT id,email INTO existing
 FROM web_auth.staff_invitations
 WHERE organization_id=org_id AND role='owner'
 AND accepted_at IS NULL AND revoked_at IS NULL
 FOR UPDATE;

 IF FOUND THEN
  IF existing.email<>invite_email THEN
   RAISE EXCEPTION 'INVITATION_ALREADY_EXISTS'
    USING ERRCODE='23505';
  END IF;

  RETURN jsonb_build_object(
   'id',existing.id,'replayed',true
  );
 END IF;

 INSERT INTO web_auth.staff_invitations
 (id,organization_id,invited_by,email,role)
 VALUES(invite_id,org_id,actor,invite_email,'owner');

 RETURN jsonb_build_object(
  'id',invite_id,'replayed',false
 );
END $$;


CREATE FUNCTION web_auth.revoke_initial_owner_invitation(
 actor uuid,org_id uuid,invite_id uuid
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog AS $$
BEGIN
 IF NOT web_auth.can_invite_initial_owner(actor,org_id) THEN
  RAISE EXCEPTION 'INVITATION_ACCESS_DENIED'
   USING ERRCODE='42501';
 END IF;

 UPDATE web_auth.staff_invitations
 SET revoked_at=clock_timestamp()
 WHERE id=invite_id AND organization_id=org_id
 AND role='owner'
 AND accepted_at IS NULL AND revoked_at IS NULL;

 RETURN FOUND;
END $$;

REVOKE ALL ON FUNCTION
 web_auth.create_initial_owner_invitation(uuid,uuid,uuid,text),
 web_auth.revoke_initial_owner_invitation(uuid,uuid,uuid)
 FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
 web_auth.create_initial_owner_invitation(uuid,uuid,uuid,text),
 web_auth.revoke_initial_owner_invitation(uuid,uuid,uuid)
 TO control_runtime;


CREATE OR REPLACE FUNCTION web_auth.pending_staff_invitations(
 actor uuid
) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER
SET search_path=pg_catalog AS $$
 SELECT coalesce(jsonb_agg(
  jsonb_build_object(
   'id',i.id,
   'organization_id',i.organization_id,
   'role',i.role,
   'expires_at',i.expires_at
  ) ORDER BY i.created_at DESC
 ),'[]'::jsonb)
 FROM web_auth.staff_invitations i
 JOIN control.users u ON lower(u.login)=i.email
 WHERE u.id=actor AND u.active
 AND u.email_verified_at IS NOT NULL
 AND i.accepted_at IS NULL
 AND i.revoked_at IS NULL
 AND i.expires_at>clock_timestamp()
 AND web_auth.invitation_authorized(i.invited_by,i.organization_id,i.role)
$$;

CREATE OR REPLACE FUNCTION web_auth.accept_staff_invitation(
 actor uuid,invite_id uuid,new_membership uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog SET control.tenant='' AS $$
DECLARE
 invitation web_auth.staff_invitations%ROWTYPE;
 actor_email text;
BEGIN
 SELECT lower(login) INTO actor_email
 FROM control.users
 WHERE id=actor AND active AND email_verified_at IS NOT NULL;

 IF NOT FOUND THEN
  RAISE EXCEPTION 'INVITATION_ACCESS_DENIED'
   USING ERRCODE='42501';
 END IF;

 SELECT * INTO invitation
 FROM web_auth.staff_invitations
 WHERE id=invite_id AND email=actor_email
 FOR UPDATE;

 IF NOT FOUND THEN
  RAISE EXCEPTION 'RESOURCE_NOT_FOUND'
   USING ERRCODE='P0002';
 END IF;

 IF invitation.accepted_by=actor THEN
  RETURN jsonb_build_object(
   'organization_id',invitation.organization_id,
   'role',invitation.role,'replayed',true
  );
 END IF;

 IF invitation.revoked_at IS NOT NULL
 OR invitation.accepted_at IS NOT NULL
 OR invitation.expires_at<=clock_timestamp()
 OR NOT web_auth.invitation_authorized(
  invitation.invited_by,invitation.organization_id,invitation.role
 ) THEN
  RAISE EXCEPTION 'INVITATION_UNAVAILABLE'
   USING ERRCODE='23514';
 END IF;

 IF invitation.role='owner' THEN
  PERFORM set_config(
   'control.tenant',invitation.organization_id::text,true
  );

  PERFORM 1 FROM control.organizations
  WHERE id=invitation.organization_id FOR UPDATE;

  IF NOT web_auth.can_invite_initial_owner(
   invitation.invited_by,invitation.organization_id
  ) THEN
   RAISE EXCEPTION 'INVITATION_UNAVAILABLE'
    USING ERRCODE='23514';
  END IF;

  INSERT INTO control.memberships
   (organization_id,id,user_id,role_id,active)
  VALUES(
   invitation.organization_id,new_membership,actor,'owner',true
  );

  UPDATE control.organizations
  SET owner_membership_id=new_membership
  WHERE id=invitation.organization_id
  AND owner_membership_id IS NULL;

 ELSIF invitation.organization_id IS NULL THEN
  INSERT INTO web_auth.internal_staff(user_id,role)
  VALUES(actor,invitation.role);
 ELSE
  PERFORM set_config(
   'control.tenant',invitation.organization_id::text,true
  );

  INSERT INTO control.memberships
   (organization_id,id,user_id,role_id,active)
  VALUES(
   invitation.organization_id,new_membership,actor,
   CASE WHEN invitation.role='manager'
    THEN 'employee' ELSE 'admin' END,
   true
  );
 END IF;

 UPDATE web_auth.staff_invitations
 SET accepted_at=clock_timestamp(),accepted_by=actor
 WHERE id=invite_id;

 RETURN jsonb_build_object(
  'organization_id',invitation.organization_id,
  'role',invitation.role,'replayed',false
 );
END $$;

CREATE OR REPLACE FUNCTION web_auth.invitation_mail_details(invite_id uuid)
RETURNS jsonb
LANGUAGE sql SECURITY DEFINER
SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('email',i.email)
 FROM web_auth.staff_invitations i
 WHERE i.id=invite_id
 AND i.revoked_at IS NULL AND i.accepted_at IS NULL
 AND i.expires_at>clock_timestamp()
 AND web_auth.invitation_authorized(i.invited_by,i.organization_id,i.role)
$$;
