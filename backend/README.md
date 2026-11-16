# SashaTel Control Plane

Node.js 24 and PostgreSQL 17. The local HTTP server binds to loopback and requires an explicit list of tenants for the in-memory fake ARI. Use a disposable database for integration tests.

1. Create an empty PostgreSQL database and a separate login named `control_runtime` with NOSUPERUSER and NOBYPASSRLS. Supply passwords externally.
2. With a migration owner, run `psql "$TEST_ADMIN_URL" -v ON_ERROR_STOP=1 -1 -f migrations/001.sql -f migrations/runtime.sql`. Integration fixtures require a local PostgreSQL administrator for seed rows behind FORCE RLS.
3. `npm ci --ignore-scripts`, `npm run typecheck`, `npm test`. Set `TEST_ADMIN_URL` and `DATABASE_URL` to the migration admin and runtime URLs. CI supplies a disposable service and credentials.
4. For manual use, seed organizations, users (passwords via `hashPassword`), memberships, subscriptions, wallets, trunks and approved phone numbers using an administrative connection. Set configuration from `.env.example` and run `npm start`.

## HTTP

| Method and path | Input |
| --- | --- |
| POST /v1/sessions | JSON `organization_id`, `login`, `password`, `device_id`. Returns an opaque 15-minute bearer token. |
| DELETE /v1/session | Revoke current bearer token. |
| POST /v1/calls | JSON `destination` in E.164, `Idempotency-Key` header, bearer. Returns 202 and the persisted status. |
| GET /v1/calls | Bearer. Latest 100 permitted calls. |
| GET /v1/calls/{id} | Bearer. Returns 404 outside permitted scope. |
| POST /v1/calls/{id}/hangup | Bearer. Request cancellation for own call. |
| GET /health | Readiness query. |

Actors are resolved from DB on every command. Login replaces the previous phone epoch globally across memberships. Manager and supervisor may call, supervisor and admin roles can read tenant-wide history. Password reauthentication renews the pilot session. The server applies a per-IP fixed-window limit. Public exposure requires TLS and a shared rate limiter.

## Reservation and recovery

The tenant row serializes mutations; the global E.164/date counter serializes shared number usage. A committed call intent consumes one initiation even if it expires, is revoked or the gateway response is lost. This conservative pilot choice prevents repeated admissions from bypassing the cap. The local calendar is configured by CALL_DAY_TIMEZONE and must match across replicas. Wallet units and reserve size are set by provisioning. Terminal settlement returns unused units and records charge and release once. Usage input is accepted only from the trusted internal adapter.

The outbox claims a durable attempt before sending. A stale originate claim is inspected using the same attempt ID. Unknown means hold the call slot and reserve; operator or future authoritative reconciliation resolves the result. There is a fail-closed check before claim. The worker also queues hangup for active calls after a critical user, membership or tenant block. The live gateway must enforce authorization at the trunk boundary to close the cross-system revoke race. The fake uses memory, so it can recover a lost response within the same instance. Restart loses fake events and channels.

Live ARI, gated PJSIP, WSS/ICE, CEL/CDR charge mapping, live gateway enforcement of active revocation, WebSocket replay, refresh, full administrative provisioning/audit and durable event ingestion are follow-up work. The current local fake server is for backend validation.
