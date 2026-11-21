# SashaTel — внутренние организации: staging rollout

## State
- Backend PR #46 merged as `f953952b37da3415f19c7bd95f26f8aa5bba2917`, PostgreSQL 17 CI passed.
- Web PR #47 merged as `94226a0ec926fce179b75e8be31f3a760f8f1c01`, E2E actual Backend/PostgreSQL CI passed.
- Published immutable backend Docker image:
  `cr.yandex/crpjs1v75pobqqd0ij5t/sashatel-backend@sha256:dad6c53c1112324b4fc9cc0d9dec86ee46d313c6b2439f180bf902f834dde534` (merge SHA).
- Rebuild workflow also published image at `@sha256:0b6e9deea9ce79d33d28eb0e7144d0ccf2f93bc95b2e9bd042c394c0db54f7d8` (same app code; workflow comment update).
- **No proof of YC runtime rollout or public Web publication yet.**

## Database migration
On YC VM `sashatel-staging-api-1` the existing Backend container is `sashatel-staging-api-session-fix` on local `127.0.0.1:8083`. PostgreSQL must be Running/Alive and connected before migration.

Do not paste credentials into messages. File paths:
- `/etc/sashatel/staging/migration-database-url` — migration connection
- `/etc/sashatel/staging/database-ca.pem` — TLS CA

Use exact immutable Docker image and migration runner:
```bash
IMAGE='cr.yandex/crpjs1v75pobqqd0ij5t/sashatel-backend@sha256:dad6c53c1112324b4fc9cc0d9dec86ee46d313c6b2439f180bf902f834dde534'
sudo docker run --rm \
  --network container:sashatel-staging-api-session-fix \
  --mount type=bind,src=/etc/sashatel/staging/migration-database-url,dst=/run/secrets/migration_database_url,readonly \
  --mount type=bind,src=/etc/sashatel/staging/database-ca.pem,dst=/run/secrets/database_ca,readonly \
  -e MIGRATION_DATABASE_URL_FILE=/run/secrets/migration_database_url \
  -e DATABASE_CA_FILE=/run/secrets/database_ca \
  --entrypoint node "$IMAGE" migrate.ts
```
The migration runner records checksums and executes only pending files. `010-internal-organization-reviews.sql` removes global INN uniqueness, creates a partial unique index for verified organizations and creates staff/review tables and privileged functions.

## Staff provisioning — DBA-only
Never allow customer registration or an email suffix to assign internal roles. A verified account must already exist in `control.users`.

Connect as the migration DBA and provision a single explicitly authorized user:
```sql
INSERT INTO web_auth.internal_staff (user_id,role)
SELECT id, 'admin' FROM control.users
WHERE lower(login)=lower(:approved_email)
  AND email_verified_at IS NOT NULL AND active
ON CONFLICT (user_id) DO UPDATE
SET active=true,role='admin';
```
Check `ROW_COUNT=1`; otherwise STOP. `reviewer` is the second supported role. Staff lookup and revocation must be DBA-audited, not self-service.

## Backend container rollout
Preserve existing `docker inspect .Config.Env` privately, network `sashatel-staging_default`, bind secrets and `127.0.0.1:8083:8080`, restart `unless-stopped`. **Never print secrets in logs.** Rename the old container to a timestamped rollback name rather than deleting it. Start the new immutable image, check:
- `curl --fail http://127.0.0.1:8083/ready` returns `{"status":"ready"}`
- `curl --fail http://127.0.0.1:8083/v1/auth/csrf` contains `csrf_token`
- Stop and restore the old container automatically if either fails.

## Web release and acceptance
Release UI SHA `94226a0ec926fce179b75e8be31f3a760f8f1c01` only after Backend and migration 010 are running. Because Vercel Hobby may limit daily builds, check current deployment status; do not claim success from GitHub CI alone.

Acceptance tests on real staging:
1. Login as normal organization owner: `/admin/` must be denied (403).
2. Login as explicitly granted SashaTel internal staff: `/admin/` lists the actual organizations.
3. Two different clients can create **unverified** organizations with the same INN.
4. Reviewer checks evidence and verifies only one; all subsequent create calls for the claimed INN return 409.
5. Rejecting a pending duplicate changes only its own status; every review writes `organization_reviews` and `web_auth.audit`.
6. Organization status updates in client Web on reload, while subscriptions/telephony remain disabled until independent provisioning.
7. Preserve old container and verify reverse rollback to prior API if needed.

**Not included:** staff directory and invitations, operator/PBX control, payments, billing or production PSTN dialing. These require separate secured APIs and integration validation.
