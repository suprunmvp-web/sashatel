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

## SashaTel v1.1 — canonical compatibility requirements (2026-11-19)

Source of truth: [product spec v1.1](https://github.com/suprunmvp-web/sashatel/blob/docs/product-spec-v1-20261117/docs/product/sashatel-spec-v1.0.md) and [decision history](https://github.com/suprunmvp-web/sashatel/blob/docs/product-spec-v1-20261117/docs/product/PROJECT-HANDOFF-RU.md). The historical labels «На удаление» are superseded by **«Активные» / «Пассивные»** in UI and APIs (internal `active/passive`). Passive excludes **all new** dispatch immediately; deletion from operator inventory is a separate job. All +50% purchased extra numbers may be active in rotation. Retiring must not interrupt an existing call; pending uncommitted holds revalidate status.

An organization has a default trunk (first working trunk by default). A new employee inherits it; administrator may set a per-employee trunk override and bulk-assign. Effective trunk is server-resolved; no Desktop per-call selection and **no automatic provider failover**. Every call/event/CDR/history/statistics/CSV retains actual `trunk_id` and supports trunk filter. Only carrier-approved CLI under that trunk may be used. A real physical CLI's global quota is at most eight initiation commits per Europe/Moscow calendar day across concurrent users and organizations; legacy per-tenant or per-trunk counters alone do not satisfy this.

Public call result labels: **«Дозвон»** (verified human), **«Автоответчик»** (verified machine), **«Недозвон»** (no answer), **«Отклонено»** (rejection signal; not proof the recipient deliberately pressed decline), **«Ошибка»** (technical failure), **«Не распознано»** (answer occurred but responder type unverified). Do **not** merge unrecognized into machine, or mark human based only on SIP 200. Agent cancellation before answer is a separate reason; hangup actor after answer is evidence metadata, not a new result.

SashaTel bills **only verified human conversation minutes** at 3 RUB/min, postpaid, with voluntary partial advance payments credited only upon confirmed receipt, no balance-gated prepay/credit limit. Past due after five working days blocks **new** calls without dropping existing calls. Carrier charges are separate. Human detection quality, rounding policy, invoice/tax workflows require release validation, never silent fallback to charging all SIP-answered minutes.

Backend is authoritative; one private ARI worker, versioned trunk provisioning, durable dispatch, event dedupe and recovery, PBX instance ID. One initial Asterisk instance, multi-PBX-ready schema. Unified technical trunk statuses with documentation, no AI diagnostic suggestions. **Do not claim v1.1 behavior implemented merely because this note exists.**
