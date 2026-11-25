
ALTER TABLE control.organizations
 ADD COLUMN responsible_manager_id uuid
 REFERENCES web_auth.internal_staff(user_id);

CREATE INDEX organizations_responsible_manager_idx
 ON control.organizations(responsible_manager_id);

CREATE FUNCTION web_auth.responsible_manager_candidates(actor uuid)
RETURNS TABLE(user_id uuid,email text,role text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog AS $$
BEGIN
 IF coalesce(web_auth.internal_staff_role(actor),'')
    NOT IN ('owner','admin') THEN
  RAISE EXCEPTION 'INTERNAL_ACCESS_DENIED'
   USING ERRCODE='42501';
 END IF;

 RETURN QUERY
 SELECT s.user_id,u.login,s.role
 FROM web_auth.internal_staff s
 JOIN control.users u ON u.id=s.user_id
 WHERE s.active AND u.active
 AND u.email_verified_at IS NOT NULL
 AND s.role IN ('owner','admin','manager')
 ORDER BY u.login;
END $$;

REVOKE ALL ON FUNCTION
 web_auth.responsible_manager_candidates(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
 web_auth.responsible_manager_candidates(uuid) TO control_runtime;

CREATE FUNCTION web_auth.set_responsible_manager(
 actor uuid,org_id uuid,target uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog AS $$
DECLARE previous uuid;
BEGIN
 PERFORM 1 FROM web_auth.internal_staff s
 JOIN control.users u ON u.id=s.user_id
 WHERE s.user_id=actor AND s.active AND u.active
 AND u.email_verified_at IS NOT NULL
 AND s.role IN ('owner','admin')
 FOR SHARE OF s;

 IF NOT FOUND THEN
  RAISE EXCEPTION 'INTERNAL_ACCESS_DENIED'
   USING ERRCODE='42501';
 END IF;

 IF target IS NOT NULL THEN
  PERFORM 1 FROM web_auth.internal_staff s
  JOIN control.users u ON u.id=s.user_id
  WHERE s.user_id=target AND s.active AND u.active
  AND u.email_verified_at IS NOT NULL
  AND s.role IN ('owner','admin','manager')
  FOR SHARE OF s,u;

  IF NOT FOUND THEN
   RAISE EXCEPTION 'INVALID_RESPONSIBLE_MANAGER'
    USING ERRCODE='22023';
  END IF;
 END IF;

 SELECT o.responsible_manager_id INTO previous
 FROM control.organizations o
 WHERE o.id=org_id AND o.active
 FOR UPDATE;

 IF NOT FOUND THEN
  RAISE EXCEPTION 'RESOURCE_NOT_FOUND'
   USING ERRCODE='P0002';
 END IF;

 IF previous IS NOT DISTINCT FROM target THEN
  RETURN NULL;
 END IF;

 UPDATE control.organizations
 SET responsible_manager_id=target
 WHERE id=org_id;

 RETURN jsonb_build_object(
  'previous_manager_id',previous,
  'responsible_manager_id',target
 );
END $$;

REVOKE ALL ON FUNCTION
 web_auth.set_responsible_manager(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
 web_auth.set_responsible_manager(uuid,uuid,uuid) TO control_runtime;

DROP FUNCTION web_auth.internal_organizations_page(uuid,integer,integer);
CREATE FUNCTION web_auth.internal_organizations_page(
 actor uuid, p_offset integer, p_limit integer, p_manager text
)
RETURNS TABLE (
 id uuid, inn text, legal_name text, legal_address text,
 verification_status text, active boolean, created_owner_email text, display_name text,
 responsible_manager_id uuid,
 responsible_manager_email text,
 responsible_manager_active boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE staff_role text:=web_auth.internal_staff_role(actor);
BEGIN
 IF p_offset<0 OR p_offset>100000 OR p_limit<1 OR p_limit>200 THEN
  RAISE EXCEPTION 'INVALID_PAGE' USING ERRCODE='22023';
 END IF;
 IF staff_role IS NULL THEN RAISE EXCEPTION 'INTERNAL_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 RETURN QUERY
 SELECT o.id,o.inn,o.legal_name,CASE WHEN staff_role<>'manager' THEN o.legal_address END,
        o.verification_status,o.active,CASE WHEN staff_role<>'manager' THEN u.login END,
        coalesce(o.display_name,o.legal_name),
        o.responsible_manager_id,ru.login,
        coalesce(rs.active AND ru.active
          AND ru.email_verified_at IS NOT NULL
          AND rs.role IN ('owner','admin','manager'),false)
 FROM control.organizations o
 LEFT JOIN control.memberships m ON m.organization_id=o.id AND m.id=o.owner_membership_id
 LEFT JOIN control.users u ON u.id=m.user_id
 LEFT JOIN web_auth.internal_staff rs
  ON rs.user_id=o.responsible_manager_id
 LEFT JOIN control.users ru
  ON ru.id=rs.user_id
 WHERE p_manager IS NULL
 OR (p_manager='unassigned' AND o.responsible_manager_id IS NULL)
 OR o.responsible_manager_id::text=p_manager
 ORDER BY (o.verification_status='unverified') DESC,o.id
 LIMIT p_limit+1 OFFSET p_offset;
END $$;
REVOKE ALL ON FUNCTION web_auth.internal_organizations_page(uuid,integer,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION web_auth.internal_organizations_page(uuid,integer,integer,text) TO control_runtime;
