-- Run explicitly as the migration operator after reviewing the existing staff list.
BEGIN;
LOCK TABLE web_auth.internal_staff IN SHARE ROW EXCLUSIVE MODE;
DO $$
DECLARE owner_id uuid;
BEGIN
 SELECT id INTO STRICT owner_id FROM control.users
  WHERE lower(login)='suprunmvp@gmail.com' AND active AND email_verified_at IS NOT NULL
  FOR UPDATE;
 IF EXISTS(SELECT 1 FROM web_auth.internal_staff WHERE user_id=owner_id AND protected_owner) THEN
  RETURN;
 END IF;
 IF EXISTS(SELECT 1 FROM web_auth.internal_staff WHERE role='owner' AND user_id<>owner_id) THEN
  RAISE EXCEPTION 'A different internal owner already exists';
 END IF;
 INSERT INTO web_auth.internal_staff(user_id,role,active,protected_owner)
 VALUES(owner_id,'owner',true,true) ON CONFLICT(user_id) DO UPDATE
 SET role='owner',active=true,protected_owner=true,granted_at=clock_timestamp();
 INSERT INTO web_auth.audit(actor_user_id,action,target_id,request_id,changes)
 VALUES(NULL,'internal.system_owner_bootstrapped',owner_id,gen_random_uuid(),'{"role":"owner","source":"operator"}');
END $$;
COMMIT;
