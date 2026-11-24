ALTER TABLE control.organizations ADD COLUMN display_name text
 CHECK (display_name IS NULL OR char_length(display_name) BETWEEN 1 AND 180);

ALTER TABLE web_auth.internal_staff DROP CONSTRAINT internal_staff_role_check;
ALTER TABLE web_auth.internal_staff ADD CONSTRAINT internal_staff_role_check
 CHECK (role IN ('owner','admin','manager','reviewer'));
ALTER TABLE web_auth.internal_staff ADD COLUMN protected_owner boolean NOT NULL DEFAULT false
 CHECK (NOT protected_owner OR (role='owner' AND active));
CREATE UNIQUE INDEX internal_staff_one_protected_owner ON web_auth.internal_staff(protected_owner) WHERE protected_owner;

CREATE FUNCTION web_auth.protect_system_owner() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF OLD.protected_owner THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'PROTECTED_OWNER' USING ERRCODE='42501'; END IF;
  IF NEW.user_id<>OLD.user_id OR NOT NEW.protected_owner OR NEW.role<>'owner' OR NOT NEW.active THEN
   RAISE EXCEPTION 'PROTECTED_OWNER' USING ERRCODE='42501';
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION web_auth.protect_system_owner() FROM PUBLIC;
CREATE TRIGGER protect_system_owner BEFORE UPDATE OR DELETE ON web_auth.internal_staff
 FOR EACH ROW EXECUTE FUNCTION web_auth.protect_system_owner();

CREATE FUNCTION web_auth.protect_system_owner_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF (NOT NEW.active OR NEW.email_verified_at IS NULL OR NEW.login<>OLD.login) AND EXISTS (
  SELECT 1 FROM web_auth.internal_staff WHERE user_id=OLD.id AND protected_owner
 ) THEN RAISE EXCEPTION 'PROTECTED_OWNER' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION web_auth.protect_system_owner_identity() FROM PUBLIC;
CREATE TRIGGER protect_system_owner_identity BEFORE UPDATE OF active,email_verified_at,login ON control.users
 FOR EACH ROW EXECUTE FUNCTION web_auth.protect_system_owner_identity();

CREATE TABLE web_auth.internal_client_contexts (
 id uuid PRIMARY KEY,
 family_id uuid NOT NULL UNIQUE REFERENCES web_auth.families(id) ON DELETE CASCADE,
 organization_id uuid NOT NULL REFERENCES control.organizations(id),
 expires_at timestamptz NOT NULL
);
REVOKE ALL ON web_auth.internal_client_contexts FROM PUBLIC;

CREATE FUNCTION web_auth.internal_client_view(actor uuid, family uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('id',c.id,'expires_at',c.expires_at,'permissions',jsonb_build_array('organization:read'),
  'organization',jsonb_build_object('id',o.id,'inn',o.inn,'legal_name',o.legal_name,
    'display_name',coalesce(o.display_name,o.legal_name),'verification_status',o.verification_status))
 FROM web_auth.internal_client_contexts c
 JOIN web_auth.families f ON f.id=c.family_id
 JOIN control.organizations o ON o.id=c.organization_id
 WHERE f.id=family AND f.user_id=actor AND f.revoked_at IS NULL AND o.active
   AND c.expires_at>statement_timestamp()
   AND web_auth.internal_staff_role(actor) IN ('owner','admin','manager')
$$;
REVOKE ALL ON FUNCTION web_auth.internal_client_view(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION web_auth.internal_client_view(uuid,uuid) TO control_runtime;

CREATE FUNCTION web_auth.open_internal_client(actor uuid, family uuid, org_id uuid, new_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM 1 FROM web_auth.internal_staff s JOIN control.users u ON u.id=s.user_id
  WHERE s.user_id=actor AND s.active AND s.role IN ('owner','admin','manager') AND u.active
    AND u.email_verified_at IS NOT NULL FOR SHARE OF s;
 IF NOT FOUND THEN RAISE EXCEPTION 'INTERNAL_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM web_auth.families WHERE id=family AND user_id=actor AND revoked_at IS NULL)
 THEN RAISE EXCEPTION 'INTERNAL_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS (SELECT 1 FROM control.organizations WHERE id=org_id AND active)
 THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 DELETE FROM web_auth.internal_client_contexts WHERE family_id=family AND expires_at<=clock_timestamp();
 IF EXISTS (SELECT 1 FROM web_auth.internal_client_contexts WHERE family_id=family)
 THEN RAISE EXCEPTION 'INTERNAL_CONTEXT_ACTIVE' USING ERRCODE='23514'; END IF;
 INSERT INTO web_auth.internal_client_contexts VALUES(new_id,family,org_id,clock_timestamp()+interval '15 minutes');
 RETURN web_auth.internal_client_view(actor,family);
END $$;
REVOKE ALL ON FUNCTION web_auth.open_internal_client(uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION web_auth.open_internal_client(uuid,uuid,uuid,uuid) TO control_runtime;

CREATE FUNCTION web_auth.close_internal_client(actor uuid, family uuid, context_id uuid) RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 DELETE FROM web_auth.internal_client_contexts c USING web_auth.families f
 WHERE c.family_id=f.id AND f.id=family AND f.user_id=actor AND c.id=context_id
 RETURNING c.organization_id
$$;
REVOKE ALL ON FUNCTION web_auth.close_internal_client(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION web_auth.close_internal_client(uuid,uuid,uuid) TO control_runtime;

CREATE FUNCTION web_auth.list_internal_staff(actor uuid)
 RETURNS TABLE(user_id uuid, email text, role text, active boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF web_auth.internal_staff_role(actor) IS DISTINCT FROM 'owner'
 THEN RAISE EXCEPTION 'INTERNAL_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT s.user_id,u.login,s.role,(s.active AND u.active)
 FROM web_auth.internal_staff s JOIN control.users u ON u.id=s.user_id ORDER BY u.login;
END $$;
REVOKE ALL ON FUNCTION web_auth.list_internal_staff(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION web_auth.list_internal_staff(uuid) TO control_runtime;

CREATE FUNCTION web_auth.set_internal_staff(actor uuid, target uuid, next_role text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE old_role text; old_active boolean; target_id uuid; closed_contexts integer;
BEGIN
 IF web_auth.internal_staff_role(actor) IS DISTINCT FROM 'owner'
 THEN RAISE EXCEPTION 'INTERNAL_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 IF next_role IS NOT NULL AND next_role NOT IN ('admin','manager')
 THEN RAISE EXCEPTION 'INVALID_ROLE' USING ERRCODE='22023'; END IF;
 -- Serialize grants and revocations even for targets with no staff row yet.
 SELECT id INTO target_id FROM control.users WHERE id=target
  AND (next_role IS NULL OR (active AND email_verified_at IS NOT NULL)) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 SELECT role,active INTO old_role,old_active FROM web_auth.internal_staff WHERE user_id=target FOR UPDATE;
 IF old_role='owner' THEN RAISE EXCEPTION 'PROTECTED_OWNER' USING ERRCODE='42501'; END IF;
 IF next_role IS NULL AND old_role IS NULL THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 IF old_role=next_role AND old_active OR (next_role IS NULL AND NOT old_active) THEN RETURN NULL; END IF;
 IF next_role IS NULL THEN
  UPDATE web_auth.internal_staff SET active=false WHERE user_id=target;
 ELSE
  INSERT INTO web_auth.internal_staff(user_id,role) VALUES(target,next_role)
   ON CONFLICT(user_id) DO UPDATE SET role=EXCLUDED.role,active=true,granted_at=clock_timestamp();
 END IF;
 DELETE FROM web_auth.internal_client_contexts c USING web_auth.families f
  WHERE c.family_id=f.id AND f.user_id=target;
 GET DIAGNOSTICS closed_contexts=ROW_COUNT;
 RETURN jsonb_build_object('previous_role',old_role,'previous_active',old_active,
  'role',coalesce(next_role,old_role),'active',next_role IS NOT NULL,'closed_contexts',closed_contexts);
END $$;
REVOKE ALL ON FUNCTION web_auth.set_internal_staff(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION web_auth.set_internal_staff(uuid,uuid,text) TO control_runtime;

CREATE FUNCTION web_auth.rename_organization(actor uuid, org_id uuid, new_name text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE old_name text;
BEGIN
 IF new_name IS NULL OR char_length(new_name) NOT BETWEEN 1 AND 180 OR new_name<>btrim(new_name)
 THEN RAISE EXCEPTION 'INVALID_DISPLAY_NAME' USING ERRCODE='22023'; END IF;
 SELECT coalesce(o.display_name,o.legal_name) INTO old_name FROM control.organizations o
 JOIN control.memberships m ON m.organization_id=o.id
 WHERE o.id=org_id AND o.active AND m.active AND m.user_id=actor
   AND (o.owner_membership_id=m.id OR m.role_id='admin') FOR UPDATE OF o FOR SHARE OF m;
 IF NOT FOUND THEN RAISE EXCEPTION 'ORGANIZATION_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 IF old_name IS NOT DISTINCT FROM new_name THEN RETURN NULL; END IF;
 UPDATE control.organizations SET display_name=new_name WHERE id=org_id;
 RETURN jsonb_build_object('previous_display_name',old_name,'display_name',new_name);
END $$;
REVOKE ALL ON FUNCTION web_auth.rename_organization(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION web_auth.rename_organization(uuid,uuid,text) TO control_runtime;

-- Preserve the existing reviewer workflow during the manual role transition.
CREATE OR REPLACE FUNCTION web_auth.review_organization(
 actor uuid, org_id uuid, decision text,
 evidence text, explanation text, review_id uuid
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE current_inn text; current_status text;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM web_auth.internal_staff s
   JOIN control.users u ON u.id=s.user_id
   WHERE s.user_id=actor AND s.active AND s.role IN ('owner','admin','reviewer') AND u.active
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

DROP FUNCTION web_auth.account_organizations(uuid);
CREATE FUNCTION web_auth.account_organizations(account_id uuid)
RETURNS TABLE (
 id uuid, inn text, legal_name text, verification_status text,
 membership_id uuid, role text, status text, display_name text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT o.id,o.inn,o.legal_name,o.verification_status,m.id,
   CASE WHEN o.owner_membership_id=m.id THEN 'owner' ELSE m.role_id END,
   CASE WHEN o.active THEN 'active' ELSE 'suspended' END,coalesce(o.display_name,o.legal_name)
 FROM control.memberships m
 JOIN control.organizations o ON o.id=m.organization_id
 WHERE m.user_id=account_id AND m.active
 ORDER BY o.id
$$;
REVOKE ALL ON FUNCTION web_auth.account_organizations(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION web_auth.account_organizations(uuid) TO control_runtime;

REVOKE EXECUTE ON FUNCTION web_auth.internal_organizations(uuid) FROM control_runtime;
DROP FUNCTION web_auth.internal_organizations_page(uuid,integer,integer);
CREATE FUNCTION web_auth.internal_organizations_page(
 actor uuid, p_offset integer, p_limit integer
)
RETURNS TABLE (
 id uuid, inn text, legal_name text, legal_address text,
 verification_status text, active boolean, created_owner_email text, display_name text
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
        coalesce(o.display_name,o.legal_name)
 FROM control.organizations o
 LEFT JOIN control.memberships m ON m.organization_id=o.id AND m.id=o.owner_membership_id
 LEFT JOIN control.users u ON u.id=m.user_id
 ORDER BY (o.verification_status='unverified') DESC,o.id
 LIMIT p_limit+1 OFFSET p_offset;
END $$;
REVOKE ALL ON FUNCTION web_auth.internal_organizations_page(uuid,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION web_auth.internal_organizations_page(uuid,integer,integer) TO control_runtime;
