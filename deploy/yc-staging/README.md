# SashaTel — Yandex Cloud staging (non-PSTN)

Destination catalog: `sashatel-staging`. Administrative catalog: `sashatel-admin`. Never apply this configuration to `sashatel-production`.

## What is included

The currently committed application entrypoint is the isolated Web/onboarding API with a test email sink. It explicitly requires `LIVE_CALL_DISPATCH=disabled`. The private ARI client and call-worker libraries are NOT wired into this server's runtime. This deployment is a **safe HTTP/DB staging foothold**, NOT a working PBX, calling product or commercial billing service.

Compose is restricted to host `127.0.0.1`; expose it only through an authenticated, TLS-terminating reverse proxy after verification. There is no automatic mock fallback.

## Prerequisites

- Yandex Cloud catalog ID for `sashatel-staging`, chosen availability zone and budget alert.
- Staging-only Compute Cloud VM with Docker/Compose and carefully scoped access; no inbound public port 8080. Use SSH via protected administration path.
- Managed PostgreSQL 17 in staging, separate schema migration owner and non-owner `control_runtime`, private database access, CA certificate, backup policy.
- Private secret files: `database-url`, `migration-database-url`, `database-ca.pem`, `auth-key` (64 hex characters). Runtime and migration credentials MUST belong to distinct identities. Place outside repo under `/etc/sashatel/staging/`, owner-only access with appropriate read access for UID 1000 in the container. Never commit passwords, tokens, SQL connections, state files or key material.
- Authorized domain/origin. Replace the example `WEB_ORIGIN` with the exact staging frontend origin.

## Manual pre-deployment validation

1. Run `npm ci --ignore-scripts && npm run typecheck && npm test` in `backend/` against a **disposable** PostgreSQL 17 instance; never run the test suite with production credentials.
2. Run the checksum-based `backend/migrate.ts` **once from a migration job** using `MIGRATION_DATABASE_URL_FILE` and the migration-owner URL, not from the public API container. Verify migration digests and schema before each rollout.
3. Export a reviewed immutable BACKEND_IMAGE digest (from the successful GitHub Actions push) and validate Compose: `docker compose --env-file /secure/path/staging.env -f deploy/yc-staging/compose.yaml config -q`.
4. Pull only the tested immutable `BACKEND_IMAGE` via short-lived registry credentials; do not build on the VM. After database backup/restore check, run the one-shot job: `docker compose --env-file /secure/path/staging.env -f deploy/yc-staging/compose.yaml --profile migration run --rm migrate`. Verify migration history and non-owner grants. Only then run `docker compose --env-file /secure/path/staging.env -f deploy/yc-staging/compose.yaml up -d api`. Never run the migration profile automatically during a normal deployment.
5. Check `curl -fsS http://127.0.0.1:8080/ready`, owner role, RLS, application logs and rollback feasibility. Keep inbound network exposure closed until TLS, authentication and real end-to-end paths are verified.

## Safe rollback

Pin a reviewed Git commit SHA; keep the previous image/digest and previous Compose manifest. Roll back the application image to that known-good digest, **not** the database schema blindly. All migrations must be forward-compatible and checked for backwards compatibility. Test restore from a backup before relying on it.

## CI authentication — decision

Prefer GitHub Actions OIDC → Yandex Cloud Workload Identity Federation bound to a **protected staging deployment environment**, over long-lived service account keys. Split infrastructure-provisioning IAM from deploy-only IAM. Require review before cost-incurring Terraform apply and allow no production folder rights. Never automatically apply Terraform from feature branches.

## Explicit hold points

Do not turn on live dispatch until there is a verified two-leg ARI worker, real SIP/PSTN reachability, provider-approved CLI, durable events, billing classification and tested rollback. Do not assume that empty folders mean a VM, database, VPC or service account already exists.

Source contracts: `docs/product/PROJECT-HANDOFF-RU.md` and `docs/product/sashatel-spec-v1.0.md`. Deployment is additive to integration PR #32.

## Existing SashaTel staging identifiers

- Folder: `b1gi9a6gkr55k6csn9s`
- VPC: `enpthm9vaqno3a8ogprk`
- `ru-central1-a` subnet: `e9bm2hfyk1kfsoyimttp` (10.128.0.0/24)
- Container Registry: `crpjs1v75pobqqd0ij5t`
- Last successful image publication: `cr.yandex/crpjs1v75pobqqd0ij5t/sashatel-backend@sha256:fc298ec73e651c8862edd15ed9902a3380aef95c15171c1e56bbc4e7d155fd91`

Identifiers are from user-provided screenshots / successful GitHub job; they are not credentials. Before apply, validate their zone, ownership, absence of overlap, and Yandex Cloud quotas via a read-only Terraform plan. The registry-push service account is NOT an infrastructure provisioning identity. No Terraform apply or staging VM/DB is performed by this PR.

## Single staging release command (after infrastructure is provisioned)

The reviewed Terraform VM installs Docker Engine and the Compose plugin from Docker's signed Ubuntu repository via cloud-init. It creates no credentials and does not run the application automatically. Use a reviewed Ubuntu image, check cloud-init completion, supply owner-controlled read-only secret files and short-lived registry login. After database backup confirmation, execute `sudo ./deploy/yc-staging/release.sh /etc/sashatel/staging/staging.env` from the deployment checkout. The release script validates the pinned OCI digest, Compose configuration and secret-file presence, pulls the tested image, runs checksum-guarded migrations **once**, starts the API loopback-only, checks `/ready` and attempts application-only rollback to the previous immutable image if readiness fails. It never rolls back PostgreSQL automatically.

The deployment script does **not** create a VM, a database or secrets; it cannot be run from GitHub Actions without a protected staging runner, a separate scoped provisioning identity, secured remote Terraform state and approved resource cost. Readiness only means isolated Backend HTTP/DB health; neither real email delivery nor ARI/PSTN are enabled.
