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
