# ARI private transport — integration boundary

Status: **transport code only, not deployed, not a working two-leg call**.

Files:
- `ari-client.ts`: REST transport for private Asterisk ARI, authenticated and fail-closed; trusted outbound PSTN leg originate, channel inspection/hangup, mixing bridge creation/attachment/deletion.
- `ari-client.test.ts`: dependency-injected HTTP test suite; run `npm run test:ari` with Node.js >=24.
- `ari-smoke.ts`: **read-only** readiness check. Requires `ARI_BASE_URL=http://127.0.0.1:8088/ari/`, `ARI_USERNAME`, `ARI_PASSWORD_FILE`. Run only on the PBX host (or over an authenticated private tunnel). Output contains no secrets. Never expose ARI publicly.

**Security boundary:** The ARI client accepts outbound dialing parameters only from a trusted backend worker. A caller-facing API must NOT accept `carrierEndpointId`, `stasisApp`, `callerId`, `channelId`, application/dial strings, or bridge IDs from Desktop. Those values are resolved under an authorized PostgreSQL transaction from an operator-approved trunk, assigned to the employee via default/override, and stored durably before dispatch. Remote HTTPS ARI also requires explicit private ACL/VPN and validated certificates; this transport does not configure either.

**Required for functional end-to-end:** postpaid call authorization (remove prepay wallet gate), integration with global 8-per-Caller-ID quota from PR #29, durable one-owner dispatch/outbox, application name and routing config provisioned to PBX, employee media leg, two-leg bridge lifecycle, ARI event WebSocket and CEL/CDR reconciliation, verification of call classification, chargeable human-only minutes, concurrency/RLS and hangup recovery tests. Server in `server.ts` intentionally requires `LIVE_CALL_DISPATCH=disabled`; do not change without passing those gates. UIS incoming SIP/REGISTER currently has an unresolved carrier/network return-path problem.

Canonical v1.1: https://github.com/suprunmvp-web/sashatel/blob/docs/product-spec-v1-20261117/docs/product/sashatel-spec-v1.0.md
