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
- CDR/CEL are raw evidence, not one row per business call. Deduplicate on `call_id` and reconcile all legs. `ANSWERED` is a *technical* answer. `human_answer` requires separate audio assessment. Provider may bill any technically answered calls including voicemail. SashaTel billing policy for human-only minutes remains subject to formal approval/accuracy testing.

## Developers: ownership and known integration work
- **Telephony:** provision carrier-confirmed PJSIP trunk and ARI private worker, preserve lab, test egress Caller ID in real PSTN, CEL/CDR replay and rollback.
- **Backend:** implement transactional number selection/hold/commit/reconciliation, event ingestion and per-number metrics; define exact daily timezone, tie-breaking, 80 sample quality test, SpaceTel schema and audit.
- **Web:** Active/Passive bulk actions, five columns, selected-date filter only for metrics, unknown spam='—', monthly CSV administration.
- **Desktop:** no Caller ID selection, no raw SIP PSTN dial path; state transition starts at user press and maps to backend call_id.
- **QA:** include concurrent 8th / rejected 9th call, 0% human answers across all callers (mass deletion forbidden), 100% voicemail, midnight rollover, provider CLI rewrite, ARI outage, late events, carrier reject, crash recovery, passive number pending dispatch, operator never provisioned.

Referenced existing document: `docs/telephony/backend-contract.md`. This README supersedes no upstream authorization or live operational approvals.
