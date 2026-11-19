# Transactional carousel capacity — Backend handoff

Scope: source code and schema prepared, **NOT integrated with the current ControlPlane.authorize, outbox, ARI worker or deployed PostgreSQL**. Current `control.ts` still increments the legacy `number_attempts.used` at authorization; do not enable live traffic until that legacy path is migrated or disabled. Avoid double accounting.

## Implemented
- `migrations/005-carousel-capacity.sql`: tenant RLS, per-organization/per-E.164/day `held + used <= 8` DB CHECK, provider-approved Active/Passive, idempotency key unique per member, dispatch state.
- `carousel-capacity.ts`: server-only `reserve`, `commit`, `release`. One organization row lock serializes concurrent requests. Distinct tenants/trunks filtered by SQL; nonexistent / unapproved numbers excluded.
- `carousel-capacity.test.ts`: simulated query adapter tests. Execute `npm run test:carousel` in backend after `npm ci`. Real PostgreSQL race and RLS tests remain mandatory.

## Integration requirements (do not skip)
1. Authenticate Desktop session with existing ControlPlane; derive tenant/member from session, never user-supplied IDs.
2. Verify subscription/trunk/operator-approved number/organization quotas, consent controls and existing business authorization **in the same transaction** as capacity reservation. Present helper currently has its own transaction: refactor to take an existing `PoolClient` before shipping. Do not expose it as an endpoint directly.
3. Under organization lock, validate that active/passive changes share lock order with reserve/commit/release. Confirm registration of number by operator before setting `provider_approved=true`.
4. `reserve` records 30s hold; cancel/expiry release. `commit` must be a durable **single** dispatch/outbox record in that same PostgreSQL transaction, *before* ARI originate. Current helper commits budget, but does NOT enqueue dispatch. Add owner/lease and recovery; never originate twice after an uncertain response.
5. Clock boundary currently returns `DAY_CHANGED_REAUTHORIZE`; implement safe hold transfer/re-reservation under same lock to support midnight calls and release old day when appropriate.
6. Implement periodic expiry reconciler for holds and lost worker leases. Do not release committed usage.
7. Call events require `call_id`, `channel_id`, PBX instance, `caller_id`, `trunk_id`, UTC occurred_at, technical dispositions and separately classified `human/machine/unknown`. Dedupe all channel legs and reconcile ARI events vs CEL/CDR.
8. UIS currently has confirmed outbound REGISTER packets but no inbound reply at Timeweb (support ticket pending). This is an **external integration blocker**, not evidence of working PSTN.

## Design/acceptance targets
- 8 simultaneous allocators to last slot => exactly one wins, 9th denied.
- Same idempotency key => same hold, never additional outbound attempt.
- No hold charged if cancelled before commit; a committed attempt counts exactly once even if network response is lost.
- Passive and non-approved numbers never selected; tenant isolation works with RLS.
- All-human-zero and 100%-answering-machine scenarios do not trigger mass deactivation based solely on reach rate.
- SpaceTel API, 80-initiation quality evaluation, +50% reserve and batch operator CSV belong to Backend services above this layer; not included here.
- Actual PSTN end-to-end, multiworker locking, auth integration and billing correctness are *not tested* by the current unit tests.

Related: https://github.com/suprunmvp-web/sashatel/pull/28

## SashaTel v1.1 — canonical compatibility requirements (2026-11-19)

Source of truth: [product spec v1.1](https://github.com/suprunmvp-web/sashatel/blob/docs/product-spec-v1-20261117/docs/product/sashatel-spec-v1.0.md) and [decision history](https://github.com/suprunmvp-web/sashatel/blob/docs/product-spec-v1-20261117/docs/product/PROJECT-HANDOFF-RU.md). The historical labels «На удаление» are superseded by **«Активные» / «Пассивные»** in UI and APIs (internal `active/passive`). Passive excludes **all new** dispatch immediately; deletion from operator inventory is a separate job. All +50% purchased extra numbers may be active in rotation. Retiring must not interrupt an existing call; pending uncommitted holds revalidate status.

An organization has a default trunk (first working trunk by default). A new employee inherits it; administrator may set a per-employee trunk override and bulk-assign. Effective trunk is server-resolved; no Desktop per-call selection and **no automatic provider failover**. Every call/event/CDR/history/statistics/CSV retains actual `trunk_id` and supports trunk filter. Only carrier-approved CLI under that trunk may be used. A real physical CLI's global quota is at most eight initiation commits per Europe/Moscow calendar day across concurrent users and organizations; legacy per-tenant or per-trunk counters alone do not satisfy this.

Public call result labels: **«Дозвон»** (verified human), **«Автоответчик»** (verified machine), **«Недозвон»** (no answer), **«Отклонено»** (rejection signal; not proof the recipient deliberately pressed decline), **«Ошибка»** (technical failure), **«Не распознано»** (answer occurred but responder type unverified). Do **not** merge unrecognized into machine, or mark human based only on SIP 200. Agent cancellation before answer is a separate reason; hangup actor after answer is evidence metadata, not a new result.

SashaTel bills **only verified human conversation minutes** at 3 RUB/min, postpaid, with voluntary partial advance payments credited only upon confirmed receipt, no balance-gated prepay/credit limit. Past due after five working days blocks **new** calls without dropping existing calls. Carrier charges are separate. Human detection quality, rounding policy, invoice/tax workflows require release validation, never silent fallback to charging all SIP-answered minutes.

Backend is authoritative; one private ARI worker, versioned trunk provisioning, durable dispatch, event dedupe and recovery, PBX instance ID. One initial Asterisk instance, multi-PBX-ready schema. Unified technical trunk statuses with documentation, no AI diagnostic suggestions. **Do not claim v1.1 behavior implemented merely because this note exists.**
