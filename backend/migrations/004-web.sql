SET search_path=control,pg_catalog;
ALTER TABLE users ADD COLUMN first_name text, ADD COLUMN last_name text, ADD COLUMN phone text,
 ADD COLUMN email_verified_at timestamptz;
ALTER TABLE organizations ADD COLUMN inn text UNIQUE, ADD COLUMN legal_name text,
 ADD COLUMN legal_address text, ADD COLUMN verification_status text NOT NULL DEFAULT 'unverified'
 CHECK (verification_status IN ('unverified','verified')), ADD COLUMN owner_membership_id uuid;
ALTER TABLE organizations ADD CONSTRAINT owner_membership_fk FOREIGN KEY (id,owner_membership_id)
 REFERENCES memberships(organization_id,id) DEFERRABLE INITIALLY DEFERRED;
INSERT INTO roles VALUES ('owner'),('admin'),('employee');
CREATE SCHEMA web_auth;
CREATE TABLE web_auth.browsers (
 hash text PRIMARY KEY,expires_at timestamptz NOT NULL,challenge_id uuid,
 completion text,completion_family uuid,completion_expires timestamptz
);
CREATE TABLE web_auth.challenges (
 id uuid PRIMARY KEY,browser_hash text NOT NULL REFERENCES web_auth.browsers,
 email text NOT NULL,profile jsonb NOT NULL,password_hash text NOT NULL,
 code_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL,attempts integer NOT NULL DEFAULT 0,consumed_at timestamptz,
 delivery text NOT NULL DEFAULT 'queued' CHECK(delivery IN ('queued','accepted','failed')),
 poll_at timestamptz
);
CREATE TABLE web_auth.families (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES control.users,
 browser_hash text NOT NULL REFERENCES web_auth.browsers,device_id uuid NOT NULL,
 access_hash text NOT NULL UNIQUE,access_expires timestamptz NOT NULL,
 refresh_hash text NOT NULL UNIQUE,idle_expires timestamptz NOT NULL,absolute_expires timestamptz NOT NULL,
 revoked_at timestamptz,organization_id uuid REFERENCES control.organizations,context_epoch integer NOT NULL DEFAULT 0
);
CREATE TABLE web_auth.refresh_history (
 hash text PRIMARY KEY,family_id uuid NOT NULL REFERENCES web_auth.families
);
CREATE TABLE web_auth.receipts (
 browser_hash text NOT NULL REFERENCES web_auth.browsers,operation text NOT NULL,key uuid NOT NULL,
 fingerprint text NOT NULL,response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(browser_hash,operation,key)
);
CREATE TABLE web_auth.limits (
 key text PRIMARY KEY,window_start timestamptz NOT NULL,used integer NOT NULL
);
CREATE TABLE web_auth.lookups (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES control.users,inn text NOT NULL,
 legal_name text NOT NULL,legal_address text NOT NULL,expires_at timestamptz NOT NULL
);
CREATE TABLE web_auth.org_receipts (
 user_id uuid REFERENCES control.users,key uuid,fingerprint text NOT NULL,organization_id uuid NOT NULL REFERENCES control.organizations,
 PRIMARY KEY(user_id,key)
);
CREATE TABLE web_auth.audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,actor_user_id uuid REFERENCES control.users,
 organization_id uuid REFERENCES control.organizations,action text NOT NULL,target_id uuid,
 request_id uuid NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),changes jsonb NOT NULL
);
GRANT USAGE ON SCHEMA web_auth TO control_runtime;
GRANT SELECT,INSERT,UPDATE ON web_auth.browsers,web_auth.challenges,web_auth.families,web_auth.refresh_history,
 web_auth.receipts,web_auth.limits,web_auth.lookups,web_auth.org_receipts TO control_runtime;
GRANT INSERT ON web_auth.audit TO control_runtime;
GRANT USAGE ON SEQUENCE web_auth.audit_id_seq TO control_runtime;
GRANT INSERT ON control.users,control.organizations,control.memberships,control.subscriptions TO control_runtime;
GRANT UPDATE(first_name,last_name,phone,email_verified_at,password_hash) ON control.users TO control_runtime;
GRANT UPDATE(owner_membership_id) ON control.organizations TO control_runtime;
-- Tenant tables retain FORCE RLS. Account service enters a verified tenant scope for each operation.
CREATE TABLE web_auth.mail_jobs (
 challenge_id uuid PRIMARY KEY REFERENCES web_auth.challenges,envelope text,
 attempts integer NOT NULL DEFAULT 0,available_at timestamptz NOT NULL DEFAULT clock_timestamp(),completed_at timestamptz
);
GRANT SELECT,INSERT,UPDATE ON web_auth.mail_jobs TO control_runtime;
CREATE POLICY account_memberships ON control.memberships FOR SELECT
 USING(user_id=nullif(current_setting('control.account',true),'')::uuid);
CREATE FUNCTION web_auth.own_organization_ids(account_id uuid) RETURNS TABLE(organization_id uuid)
 LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
 BEGIN
   PERFORM set_config('control.account',account_id::text,true);
   RETURN QUERY SELECT m.organization_id FROM control.memberships m WHERE m.user_id=account_id AND m.active;
 END $$;
REVOKE ALL ON FUNCTION web_auth.own_organization_ids(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION web_auth.own_organization_ids(uuid) TO control_runtime;
ALTER TABLE control.trunks ALTER COLUMN active SET DEFAULT false;
-- Fail explicitly on ambiguous pre-existing case-insensitive identities.
CREATE UNIQUE INDEX users_login_canonical_unique ON control.users(lower(login));
