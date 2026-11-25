CREATE OR REPLACE FUNCTION web_auth.list_internal_staff(actor uuid)
 RETURNS TABLE(user_id uuid, email text, role text, active boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF coalesce(web_auth.internal_staff_role(actor),'') NOT IN ('owner','admin','manager')
 THEN RAISE EXCEPTION 'INTERNAL_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT s.user_id,u.login,s.role,(s.active AND u.active)
 FROM web_auth.internal_staff s JOIN control.users u ON u.id=s.user_id ORDER BY u.login;
END $$;

CREATE OR REPLACE FUNCTION web_auth.set_internal_staff(actor uuid, target uuid, next_role text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE old_role text; old_active boolean; target_id uuid; closed_contexts integer; actor_role text;
BEGIN
 SELECT web_auth.internal_staff_role(actor) INTO actor_role;
 IF coalesce(actor_role,'') NOT IN ('owner','admin')
 THEN RAISE EXCEPTION 'INTERNAL_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 IF actor=target AND actor_role='admin'
 THEN RAISE EXCEPTION 'INTERNAL_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 IF next_role IS NOT NULL AND next_role NOT IN ('admin','manager')
 THEN RAISE EXCEPTION 'INVALID_ROLE' USING ERRCODE='22023'; END IF;
 -- Serialize grants and revocations even for targets with no staff row yet.
 SELECT id INTO target_id FROM control.users WHERE id=target
  AND (next_role IS NULL OR (active AND email_verified_at IS NOT NULL)) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 SELECT role,active INTO old_role,old_active FROM web_auth.internal_staff WHERE user_id=target FOR UPDATE;
 IF actor_role='admin' AND (old_role IS NULL OR old_role NOT IN ('owner','admin','manager'))
 THEN RAISE EXCEPTION 'INTERNAL_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
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

CREATE OR REPLACE FUNCTION web_auth.review_organization(
 actor uuid, org_id uuid, decision text,
 evidence text, explanation text, review_id uuid
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE current_inn text; current_status text;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM web_auth.internal_staff s
   JOIN control.users u ON u.id=s.user_id
   WHERE s.user_id=actor AND s.active AND s.role IN ('owner','admin','manager','reviewer') AND u.active
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
