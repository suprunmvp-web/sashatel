# S1 Backend release contract for DevOps #23

Target PostgreSQL major 17, Node 24.22.1. This is an isolated Web/email-sink release, live dispatch disabled. Managed DB acceptance remains separate.

Build from repository root with `docker build -f backend/Dockerfile -t sashatel-backend:<commit> backend`. Publish to owner-approved OCI registry, deploy only immutable digest. Container build is not locally verified because Docker is unavailable on this host.

Start `node server.ts` (image default). Migration job uses SAME digest, command `node migrate.ts`, separately supplied migration URL and credential. Provision login control_runtime NOSUPERUSER NOBYPASSRLS externally. Migration identity owns schema, can create tables/functions/grants, never used by API. Migrations are transaction-per-file under PostgreSQL advisory lock with checksum journal. For a database with existing 001–003 already applied, compare exact schema/history first, then one-time ADOPT_PILOT_SCHEMA=verified adoption. Never set automatically. Backup/restore verification before adoption.

Runtime grants come from migrations/runtime.sql and later per-feature grants. Runtime has no DDL/BYPASSRLS. FORCE RLS and transaction-local tenant selection are mandatory, including pooled queries. Public migration journal readable only as necessary for readiness, no runtime mutation.

Secret-file variables, names only:
- DATABASE_URL_FILE, MIGRATION_DATABASE_URL_FILE
- DATABASE_CA_FILE
- AUTH_KEY_FILE (32-byte key, external lifecycle)
- WEB_ORIGIN (exact HTTPS origin)
- EMAIL_MODE=sink, EMAIL_SINK_DIRECTORY (private volume)
- PORT=8080, BIND_HOST=0.0.0.0
- LIVE_CALL_DISPATCH=disabled
- DADATA_API_KEY_FILE when real lookup is enabled; test lookup fixture only in tests.

Database connection uses verified TLS with CA for nonlocal DB, rejects URL sslmode overrides. Pool max10, acquire5s, idle30s, statement/query10s; tune replica total against DB connection budget. TLS terminates at trusted same-origin proxy; origin validation uses configured origin, not untrusted forwarded headers. Security headers and host cookies require external HTTPS.

Liveness GET /live →200 {status:"alive"} without DB query. Readiness GET /ready →200 {status:"ready"} only after schema/version/grants and DB query succeed, otherwise503. Preserve /health as readiness alias for pilot clients. Migration mismatch closes readiness.

Email sink stores only test messages in 0700 directory / 0600 files, separate volume and retention. Never production deliverability evidence. Code/password/token absent from logs and artifacts. No real email provider invocation in sink mode.

Calls/start guard remains closed for this S1 process. No FAKE_ARI_TENANTS auto-enrolment, no live gateway credential, no PSTN. Restore requires explicit reconciliation of legacy active intents and preserved phone fences before any future enablement. Container receives only scoped secrets, read-only root recommended, writable sink volume explicit.

This document declares implementation target. Commands/health gates are accepted only after new code and CI evidence at the same SHA. No deployment authorization is implied.

S1 replica count is exactly one while in-process refresh single-flight is used. Distributed BFF/family refresh coordination is required before scaling beyond one process. Strict reuse detection remains enabled; overlapping requests on the same process share one rotation result, later reuse revokes the family.
