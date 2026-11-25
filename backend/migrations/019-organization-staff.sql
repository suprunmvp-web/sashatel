
ALTER TABLE control.users
 ADD COLUMN registered_at timestamptz;

ALTER TABLE control.users
 ALTER COLUMN registered_at SET DEFAULT clock_timestamp();

CREATE FUNCTION web_auth.organization_staff(
 actor uuid,org_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog SET control.tenant='' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM set_config('control.tenant',org_id::text,true);

 IF NOT EXISTS(
  SELECT 1 FROM control.organizations o
  JOIN control.memberships m ON m.organization_id=o.id
  JOIN control.users u ON u.id=m.user_id
  WHERE o.id=org_id AND o.active
  AND m.user_id=actor AND m.active
  AND u.active AND u.email_verified_at IS NOT NULL
  AND (o.owner_membership_id=m.id OR m.role_id='admin')
 ) THEN
  RAISE EXCEPTION 'ORGANIZATION_ACCESS_DENIED'
   USING ERRCODE='42501';
 END IF;

 SELECT coalesce(jsonb_agg(
  jsonb_build_object(
   'membership_id',m.id,
   'user_id',u.id,
   'first_name',u.first_name,
   'last_name',u.last_name,
   'email',u.login,
   'phone',u.phone,
   'email_verified',u.email_verified_at IS NOT NULL,
   'registered_at',u.registered_at,
   'active',m.active AND u.active,
   'role',CASE
    WHEN o.owner_membership_id=m.id THEN 'owner'
    WHEN m.role_id='admin' THEN 'admin'
    WHEN m.role_id='employee' THEN 'manager'
    ELSE m.role_id
   END
  )
  ORDER BY u.last_name NULLS LAST,u.first_name NULLS LAST,u.id
 ),'[]'::jsonb)
 INTO result
 FROM control.memberships m
 JOIN control.users u ON u.id=m.user_id
 JOIN control.organizations o ON o.id=m.organization_id
 WHERE m.organization_id=org_id;

 RETURN result;
END $$;

REVOKE ALL ON FUNCTION
 web_auth.organization_staff(uuid,uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
 web_auth.organization_staff(uuid,uuid) TO control_runtime;
