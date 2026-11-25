
CREATE FUNCTION web_auth.set_organization_staff(
 actor uuid,org_id uuid,target_id uuid,
 new_role text,new_active boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog SET control.tenant='' AS $$
DECLARE
 owner_id uuid;
 actor_member record;
 target_member record;
 role_value text;
BEGIN
 IF new_role IS NULL OR new_role NOT IN ('admin','manager')
 OR new_active IS NULL THEN
  RAISE EXCEPTION 'INVALID_STAFF_ACCESS'
   USING ERRCODE='22023';
 END IF;

 PERFORM set_config('control.tenant',org_id::text,true);

 SELECT owner_membership_id INTO owner_id
 FROM control.organizations
 WHERE id=org_id AND active
 FOR UPDATE;

 IF NOT FOUND THEN
  RAISE EXCEPTION 'ORGANIZATION_ACCESS_DENIED'
   USING ERRCODE='42501';
 END IF;

 SELECT m.id,m.role_id INTO actor_member
 FROM control.memberships m
 JOIN control.users u ON u.id=m.user_id
 WHERE m.organization_id=org_id
 AND m.user_id=actor AND m.active
 AND u.active AND u.email_verified_at IS NOT NULL
 FOR SHARE OF m;

 IF NOT FOUND OR NOT (
  actor_member.id IS NOT DISTINCT FROM owner_id
  OR actor_member.role_id='admin'
 ) THEN
  RAISE EXCEPTION 'ORGANIZATION_ACCESS_DENIED'
   USING ERRCODE='42501';
 END IF;

 SELECT id,user_id,role_id,active INTO target_member
 FROM control.memberships
 WHERE organization_id=org_id AND id=target_id
 FOR UPDATE;

 IF NOT FOUND THEN
  RAISE EXCEPTION 'RESOURCE_NOT_FOUND'
   USING ERRCODE='P0002';
 END IF;

 IF target_member.id=owner_id
 OR target_member.role_id='owner' THEN
  RAISE EXCEPTION 'PROTECTED_OWNER'
   USING ERRCODE='23514';
 END IF;

 IF target_member.user_id=actor THEN
  RAISE EXCEPTION 'ORGANIZATION_ACCESS_DENIED'
   USING ERRCODE='42501';
 END IF;

 IF target_member.role_id NOT IN ('admin','employee','manager') THEN
  RAISE EXCEPTION 'INVALID_STAFF_ACCESS'
   USING ERRCODE='22023';
 END IF;

 role_value:=CASE
  WHEN new_role='manager' THEN 'employee'
  ELSE 'admin'
 END;

 IF target_member.role_id=role_value
 AND target_member.active=new_active THEN
  RETURN NULL;
 END IF;

 UPDATE control.memberships
 SET role_id=role_value,active=new_active
 WHERE organization_id=org_id AND id=target_id;

 UPDATE control.sessions
 SET revoked_at=clock_timestamp()
 WHERE organization_id=org_id AND membership_id=target_id
 AND revoked_at IS NULL;

 UPDATE web_auth.families
 SET organization_id=NULL,context_epoch=context_epoch+1
 WHERE user_id=target_member.user_id
 AND organization_id=org_id AND revoked_at IS NULL;

 RETURN jsonb_build_object(
  'membership_id',target_id,
  'previous_role',target_member.role_id,
  'role',new_role,
  'previous_active',target_member.active,
  'active',new_active
 );
END $$;

REVOKE ALL ON FUNCTION
 web_auth.set_organization_staff(uuid,uuid,uuid,text,boolean)
 FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
 web_auth.set_organization_staff(uuid,uuid,uuid,text,boolean)
 TO control_runtime;
