# Desktop operator telephony status

Proposed Backend contract for #10, #14 and #20. Backend review pending.

- `GET /v1/operator/telephony` uses a short-lived tenant/membership Bearer session with an operator read permission. Backend derives scope from the session. Do not include admin permissions, registration details or SIP secrets.
- `200` JSON: `{ telephony_available: boolean, caller_id: string | null, can_call: boolean, observed_at_ms: number }`. Return only the allowed default E.164 Caller ID. A positive can_call requires available telephony and a Caller ID. observed_at_ms is server UTC Unix milliseconds for a fresh authorization evaluation, strictly increasing for each successful read within a session. Return `Cache-Control: no-store`.
- `401` invalid or expired session, `403` missing or revoked read access. Use `200 can_call:false` for a valid session that cannot place calls. The snapshot is advisory; authoritative entitlement belongs to POST /v1/calls.
- Pilot source for main only: `SASHATEL_OPERATOR_API_ORIGIN` (trusted HTTPS origin) and `SASHATEL_OPERATOR_API_TOKEN` (via a launcher that avoids shell history). Main drops the token from its environment and clears its in-memory bearer on 401. No token in renderer or IPC.
- Desktop polls three seconds after each read; timeout 2.5 seconds and maximum snapshot age ten seconds. Failed, older, repeated, malformed and out-of-window snapshots clear the view. Explicit Demo/Test stays separate. Actual call transport remains disabled regardless of positive status.
