# SashaTel commercial PBX integration — implementable contract v1

Status: implementation scaffold, NOT live-deployed. Existing lab endpoints 1001/1002 are unrelated test clients, not production telephone numbers. This directory does not enter the existing `render.py` glob.

## Responsibility boundaries
- Desktop: only requests call via authenticated Backend; cannot choose SIP trunk, PJSIP endpoint, Caller ID, Asterisk dialplan context or ARI URL.
- Backend (PostgreSQL transaction): checks tenant access, carrier authorization, caller number active/reserved state, concurrency and daily budget; selects Caller ID, records unique `call_id`, and commits **one** dispatch. Idempotency key returns same call. Daily budget `held + used <= 8` for one real phone number; 80 starts quality review, not automatic blocking. One trunk's numbers cannot be used by another tenant.
- Asterisk: performs only Backend-authorized dial via private authenticated ARI worker; exposes channel/CEL/CDR raw evidence. Rejects direct external PSTN routes from Desktop. Never guesses MACHINE/HUMAN from SIP 200.
- Backend events: persist `call_id`, `pbx_instance_id`, `channel_id`, `linkedid`, `organization_id`, `trunk_id`, `caller_id_e164`, `destination_e164`, timestamps, SIP/Q850 causes, actual outbound asserted Caller ID where verifiable, audio classifier `human|machine|unknown` plus version/confidence, billing seconds and corrections. Dedupe per event and reconcile after ARI disconnect.
- SpaceTel: Backend-only API; positive spam finding with provenance and timestamp => passive; uncertain result is dash, never 'clean'. UI: Active / Passive, Phone / Spam / Initiations / Human answers / Reach %. Passive immediately stops new dispatch; operator deletion waits for monthly batch.
- Capacity: first month uses customer's planned initiations, later actual average monthly initiations. `ceil(monthly_initiations / (8 * calling_days) * 1.5)`; subtract active confirmed capacity & purchased pending. Calling days are explicit. +50% capacity is **not** equivalent to a guaranteed month's replacement stock. Monthly CSV import/delete workflow and emergency procurement separate.
- Endpoint registration, provider acceptance of CLI, outbound calls, answer detection, SpaceTel contract, ASR/AMD classifier precision and carrier billing **not verified**.

## Safe Asterisk commercial architecture
1. Operator-specific PJSIP transport, auth, AOR, endpoint, identify configuration is provisioned from approved carrier parameters; **do not** insert carrier secrets in Git.
2. `commercial/pjsip-trunk.conf.template` is an example for a *provider-confirmed IP-auth trunk*. Do not enable until provider CIDR, port, CLI restrictions, public NAT and RTP are verified. Registration-based trunk requires different verified config.
3. Do not expose public ARI or AMI. Private ARI worker only, with dedicated credentials and network ACL, handles Stasis legs and bridges. Before enablement, build/run integration tests for trusted origination, reject external call paths from every untrusted endpoint, parallel calls, cancellation, missed events, crash reconciliation, hold expiry and billing boundaries.
4. The `extensions-commercial.conf` dialplan intentionally has no extension that dials PSTN, so a Desktop SIP endpoint cannot bypass Backend's Caller ID limits. A backend-owned ARI `Stasis` application must place/bridge legs by approved signed request; caller provided dial string is forbidden.
5. Each operator-approved Caller ID is a separate DB object (per tenant/trunk); it is *not* an Asterisk extension. Provider can override displayed CLI; validate through a real recipient test.

## Release gate before any VPS write
- Existing unit `sashatel-asterisk.service` on Timeweb is running. Do not install example templates on live service or restart without exact current diff, snapshot/backup, canary rollback, privileged restricted deploy route and operator test trunk.
- `sashatel-deploy` SSH is currently verified but **not privileged**; the existing manual GitHub SSH workflow proves connectivity, not config deployment.
- Keep UIS-managed include and existing lab intact during tests. No live PSTN enablement, no default mocks on failed backend.
- Deploy: stage in fresh release directory -> reject unresolved placeholders and unsafe routes -> Asterisk dry validation on isolated instance -> backup -> atomic symlink under restricted root-owned deployment action -> reload only affected subsystems if supported -> outbound and failure smoke -> restore previous release on fail. Do not restart active calls without window.
- Production security: never trust client-supplied callerid; forbid outbound `from-1001`/`from-1002` access to PSTN; PJSIP endpoint namespace scoped to trunk; ARI loopback/private TLS-only + least privilege.
- CDR/CEL are raw evidence, not one row per business call. Deduplicate on `call_id` and reconcile all legs. `ANSWERED` is a *technical* answer. `human_answer` requires separate audio assessment. Provider may bill any technically answered calls including voicemail. SashaTel human-only minutes policy is PRODUCT-APPROVED in v1.1; classifier accuracy and billable-seconds implementation are NOT verified and require release tests.

## Developers: ownership and known integration work
- **Telephony:** provision carrier-confirmed PJSIP trunk and ARI private worker, preserve lab, test egress Caller ID in real PSTN, CEL/CDR replay and rollback.
- **Backend:** implement transactional number selection/hold/commit/reconciliation, event ingestion and per-number metrics; define exact daily timezone, tie-breaking, 80 sample quality test, SpaceTel schema and audit.
- **Web:** Active/Passive bulk actions, five columns, selected-date filter only for metrics, unknown spam='—', monthly CSV administration.
- **Desktop:** no Caller ID selection, no raw SIP PSTN dial path; state transition starts at user press and maps to backend call_id.
- **QA:** include concurrent 8th / rejected 9th call, 0% human answers across all callers (mass deletion forbidden), 100% voicemail, midnight rollover, provider CLI rewrite, ARI outage, late events, carrier reject, crash recovery, passive number pending dispatch, operator never provisioned.

Referenced existing document: `docs/telephony/backend-contract.md`. This README supersedes no upstream authorization or live operational approvals.

## SashaTel v1.1 — canonical compatibility requirements (2026-11-19)

Source of truth: [product spec v1.1](https://github.com/suprunmvp-web/sashatel/blob/docs/product-spec-v1-20261117/docs/product/sashatel-spec-v1.0.md) and [decision history](https://github.com/suprunmvp-web/sashatel/blob/docs/product-spec-v1-20261117/docs/product/PROJECT-HANDOFF-RU.md). The historical labels «На удаление» are superseded by **«Активные» / «Пассивные»** in UI and APIs (internal `active/passive`). Passive excludes **all new** dispatch immediately; deletion from operator inventory is a separate job. All +50% purchased extra numbers may be active in rotation. Retiring must not interrupt an existing call; pending uncommitted holds revalidate status.

An organization has a default trunk (first working trunk by default). A new employee inherits it; administrator may set a per-employee trunk override and bulk-assign. Effective trunk is server-resolved; no Desktop per-call selection and **no automatic provider failover**. Every call/event/CDR/history/statistics/CSV retains actual `trunk_id` and supports trunk filter. Only carrier-approved CLI under that trunk may be used. A real physical CLI's global quota is at most eight initiation commits per Europe/Moscow calendar day across concurrent users and organizations; legacy per-tenant or per-trunk counters alone do not satisfy this.

Public call result labels: **«Дозвон»** (verified human), **«Автоответчик»** (verified machine), **«Недозвон»** (no answer), **«Отклонено»** (rejection signal; not proof the recipient deliberately pressed decline), **«Ошибка»** (technical failure), **«Не распознано»** (answer occurred but responder type unverified). Do **not** merge unrecognized into machine, or mark human based only on SIP 200. Agent cancellation before answer is a separate reason; hangup actor after answer is evidence metadata, not a new result.

SashaTel bills **only verified human conversation minutes** at 3 RUB/min, postpaid, with voluntary partial advance payments credited only upon confirmed receipt, no balance-gated prepay/credit limit. Past due after five working days blocks **new** calls without dropping existing calls. Carrier charges are separate. Human detection quality, rounding policy, invoice/tax workflows require release validation, never silent fallback to charging all SIP-answered minutes.

Backend is authoritative; one private ARI worker, versioned trunk provisioning, durable dispatch, event dedupe and recovery, PBX instance ID. One initial Asterisk instance, multi-PBX-ready schema. Unified technical trunk statuses with documentation, no AI diagnostic suggestions. **Do not claim v1.1 behavior implemented merely because this note exists.**
