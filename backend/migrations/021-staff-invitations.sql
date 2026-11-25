
CREATE TABLE web_auth.staff_invitations (
 id uuid PRIMARY KEY,
 organization_id uuid REFERENCES control.organizations(id),
 invited_by uuid NOT NULL REFERENCES control.users(id),
 email text NOT NULL CHECK(email=lower(trim(email))),
 role text NOT NULL CHECK(role IN ('admin','manager')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT
  (clock_timestamp()+interval '7 days'),
 accepted_at timestamptz,
 accepted_by uuid REFERENCES control.users(id),
 revoked_at timestamptz,
 CHECK ((accepted_at IS NULL)=(accepted_by IS NULL)),
 CHECK (accepted_at IS NULL OR revoked_at IS NULL)
);

CREATE UNIQUE INDEX staff_invitations_pending_unique
 ON web_auth.staff_invitations(
  organization_id,email
 ) NULLS NOT DISTINCT
 WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE INDEX staff_invitations_email_idx
 ON web_auth.staff_invitations(email);

REVOKE ALL ON web_auth.staff_invitations
 FROM PUBLIC,control_runtime;


CREATE FUNCTION web_auth.can_invite_staff(
 actor uuid,org_id uuid
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog SET control.tenant='' AS $$
BEGIN
 IF org_id IS NULL THEN
  RETURN coalesce(web_auth.internal_staff_role(actor),'')
   IN ('owner','admin');
 END IF;

 PERFORM set_config('control.tenant',org_id::text,true);

 RETURN EXISTS(
  SELECT 1 FROM control.organizations o
  JOIN control.memberships m ON m.organization_id=o.id
  JOIN control.users u ON u.id=m.user_id
  WHERE o.id=org_id AND o.active
  AND m.user_id=actor AND m.active
  AND u.active AND u.email_verified_at IS NOT NULL
  AND (o.owner_membership_id=m.id OR m.role_id='admin')
 );
END $$;

REVOKE ALL ON FUNCTION
 web_auth.can_invite_staff(uuid,uuid) FROM PUBLIC;


CREATE FUNCTION web_auth.create_staff_invitation(
 actor uuid,org_id uuid,invite_id uuid,
 invite_email text,invite_role text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog SET control.tenant='' AS $$
DECLARE existing record;
BEGIN
 IF NOT web_auth.can_invite_staff(actor,org_id) THEN
  RAISE EXCEPTION 'INVITATION_ACCESS_DENIED'
   USING ERRCODE='42501';
 END IF;

 IF invite_role IS NULL
 OR invite_role NOT IN ('admin','manager')
 OR invite_email IS NULL
 OR length(invite_email)>254
 OR invite_email<>lower(trim(invite_email))
 OR invite_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
 THEN
  RAISE EXCEPTION 'INVALID_INVITATION'
   USING ERRCODE='22023';
 END IF;

 PERFORM pg_advisory_xact_lock(
  hashtextextended(
   coalesce(org_id::text,'internal')||':'||invite_email,0
  )
 );

 IF NOT web_auth.can_invite_staff(actor,org_id) THEN
  RAISE EXCEPTION 'INVITATION_ACCESS_DENIED'
   USING ERRCODE='42501';
 END IF;

 PERFORM set_config(
  'control.tenant',coalesce(org_id::text,''),true
 );

 IF org_id IS NULL THEN
  IF EXISTS(
   SELECT 1 FROM web_auth.internal_staff s
   JOIN control.users u ON u.id=s.user_id
   WHERE lower(u.login)=invite_email
  ) THEN
   RAISE EXCEPTION 'STAFF_ALREADY_EXISTS'
    USING ERRCODE='23505';
  END IF;
 ELSE
  IF EXISTS(
   SELECT 1 FROM control.memberships m
   JOIN control.users u ON u.id=m.user_id
   WHERE m.organization_id=org_id
   AND lower(u.login)=invite_email
  ) THEN
   RAISE EXCEPTION 'STAFF_ALREADY_EXISTS'
    USING ERRCODE='23505';
  END IF;
 END IF;

 UPDATE web_auth.staff_invitations
 SET revoked_at=clock_timestamp()
 WHERE organization_id IS NOT DISTINCT FROM org_id
 AND email=invite_email
 AND accepted_at IS NULL AND revoked_at IS NULL
 AND expires_at<=clock_timestamp();

 SELECT id,role,expires_at INTO existing
 FROM web_auth.staff_invitations
 WHERE organization_id IS NOT DISTINCT FROM org_id
 AND email=invite_email
 AND accepted_at IS NULL AND revoked_at IS NULL
 FOR UPDATE;

 IF FOUND THEN
  IF existing.role<>invite_role THEN
   RAISE EXCEPTION 'INVITATION_ALREADY_EXISTS'
    USING ERRCODE='23505';
  END IF;

  RETURN jsonb_build_object(
   'id',existing.id,
   'expires_at',existing.expires_at,
   'replayed',true
  );
 END IF;

 INSERT INTO web_auth.staff_invitations
 (id,organization_id,invited_by,email,role)
 VALUES(invite_id,org_id,actor,invite_email,invite_role);

 RETURN jsonb_build_object(
  'id',invite_id,
  'replayed',false
 );
END $$;


CREATE FUNCTION web_auth.pending_staff_invitations(
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
 AND web_auth.can_invite_staff(i.invited_by,i.organization_id)
$$;


CREATE FUNCTION web_auth.accept_staff_invitation(
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
 OR NOT web_auth.can_invite_staff(
  invitation.invited_by,invitation.organization_id
 ) THEN
  RAISE EXCEPTION 'INVITATION_UNAVAILABLE'
   USING ERRCODE='23514';
 END IF;

 IF invitation.organization_id IS NULL THEN
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


CREATE FUNCTION web_auth.revoke_staff_invitation(
 actor uuid,org_id uuid,invite_id uuid
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog AS $$
BEGIN
 IF NOT web_auth.can_invite_staff(actor,org_id) THEN
  RAISE EXCEPTION 'INVITATION_ACCESS_DENIED'
   USING ERRCODE='42501';
 END IF;

 UPDATE web_auth.staff_invitations
 SET revoked_at=clock_timestamp()
 WHERE id=invite_id
 AND organization_id IS NOT DISTINCT FROM org_id
 AND accepted_at IS NULL AND revoked_at IS NULL;

 RETURN FOUND;
END $$;

REVOKE ALL ON FUNCTION
 web_auth.create_staff_invitation(uuid,uuid,uuid,text,text),
 web_auth.pending_staff_invitations(uuid),
 web_auth.accept_staff_invitation(uuid,uuid,uuid),
 web_auth.revoke_staff_invitation(uuid,uuid,uuid)
 FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
 web_auth.create_staff_invitation(uuid,uuid,uuid,text,text),
 web_auth.pending_staff_invitations(uuid),
 web_auth.accept_staff_invitation(uuid,uuid,uuid),
 web_auth.revoke_staff_invitation(uuid,uuid,uuid)
 TO control_runtime;
