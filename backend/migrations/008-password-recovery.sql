-- Password recovery is separate from registration challenges.
-- Every reset is bound to the initiating preauth browser. Never store plaintext codes or tokens.
CREATE TABLE web_auth.password_resets (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES control.users(id),
 browser_hash text NOT NULL REFERENCES web_auth.browsers(hash),
 email text NOT NULL,
 code_hash text NOT NULL,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 attempts integer NOT NULL DEFAULT 0,
 verified_at timestamptz,
 reset_hash text,
 consumed_at timestamptz,
 CONSTRAINT password_resets_attempts CHECK (attempts BETWEEN 0 AND 5)
);
CREATE INDEX password_resets_user_live
 ON web_auth.password_resets(user_id,created_at DESC)
 WHERE consumed_at IS NULL;
CREATE TABLE web_auth.password_reset_mail_jobs (
 reset_id uuid PRIMARY KEY REFERENCES web_auth.password_resets(id),
 envelope text,
 attempts integer NOT NULL DEFAULT 0,
 available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 completed_at timestamptz,
 lease_token uuid,
 lease_until timestamptz,
 CONSTRAINT reset_mail_lease_pair CHECK (
   (lease_token IS NULL AND lease_until IS NULL)
   OR (lease_token IS NOT NULL AND lease_until IS NOT NULL)
 )
);
CREATE INDEX password_reset_mail_claim_idx
 ON web_auth.password_reset_mail_jobs (available_at,lease_until)
 WHERE completed_at IS NULL;
GRANT SELECT,INSERT,UPDATE ON web_auth.password_resets,web_auth.password_reset_mail_jobs TO control_runtime;
