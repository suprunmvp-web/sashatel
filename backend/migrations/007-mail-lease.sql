
-- Durable ownership of transactional email jobs.
-- A crashed worker releases its claim when the lease expires.

ALTER TABLE web_auth.mail_jobs
  ADD COLUMN lease_token uuid,
  ADD COLUMN lease_until timestamptz;

ALTER TABLE web_auth.mail_jobs
  ADD CONSTRAINT mail_jobs_lease_pair CHECK (
    (lease_token IS NULL AND lease_until IS NULL)
    OR
    (lease_token IS NOT NULL AND lease_until IS NOT NULL)
  );

CREATE INDEX mail_jobs_claim_idx
  ON web_auth.mail_jobs (available_at, lease_until)
  WHERE completed_at IS NULL;
