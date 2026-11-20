# SashaTel — first PSTN call release gate (2026-11-19)

Status: **BLOCKED BY PROVIDER NETWORK**, not an Asterisk configuration verdict.

## Evidence supplied by the operator

- VPS public IP: `129.101.102.107`, Asterisk SIP/UDP local port `5062`.
- Six outgoing UDP REGISTER datagrams to UIS `195.211.122.91:5060` during a tcpdump capture.
- No inbound SIP packets observed during that capture.
- Asterisk socket bound to UDP/5062; UFW permits incoming UDP/5062 from UIS.
- Timeweb support explicitly states a network-level restriction on SIP/5060 remains after legal-entity conversion; review requires business purpose and verified Russian phone number.
- The customer submitted the business explanation and confirmed the account phone number. **No evidence yet that Timeweb unblocked traffic.**

These observations do not prove which network direction is blocked or that UIS received the six specific REGISTER datagrams. Do not change PJSIP credentials randomly to mask network evidence. A change to local UFW is not proof of cloud-edge reachability.

## Separate three gates

1. **Network reachability (Timeweb/UIS):** ask Timeweb to confirm outbound UDP destination port 5060 and UDP return path to source 5062 at cloud network edge; 5060 filtering and 5062 inbound filtering are independent conditions. Capture both ends over the same bounded window with UTC timestamps and 5-tuple, and redact credentials. Obtain UIS confirmation of registration request receipt and sent response for the same sequence. A SIP `401 Unauthorized` challenge can be an expected part of digest registration, not itself a failure. Do not claim registration succeeded until an authorized REGISTER obtains 200 OK.
2. **SIP/PSTN contract (once network available):** provider-approved outgoing Caller ID for the exact trunk, successful registration, authenticated INVITE, correct SDP/NAT contact, two-way RTP audio, expected codec negotiation, call teardown and CDR correlation. Keep signalling capture separate from RTP diagnosis. Don't log SIP digest credentials or personal audio.
3. **Application/business gate:** Desktop permission and assigned trunk; atomic physical Caller ID quota (<=8 initiations/day Europe/Moscow); one-shot outbound attempt on timeout; Asterisk ARI private connectivity; event dedupe, uncertain-call reconciliation and teardown; trusted answer classification (human/machine/unknown); only verified-human seconds charged, 0 charge for unknown or machine; billable-duration reconciliation and audit; ongoing call does not drop on payment hold; rollback and incident observability.

## Pass/fail evidence for the first controlled call

- [ ] Timeweb confirms restriction lifted (or approved transport arrangement) with a timestamp and exact direction/ports.
- [ ] Simultaneous Timeweb/Asterisk + UIS packet traces show one matching registration exchange (requests and responses).
- [ ] SIP REGISTER authorized and a provider-approved outbound INVITE returns a verifiable response.
- [ ] Real callee receives the call; 2-way RTP passes and both legs end cleanly.
- [ ] Exactly one call attempt ID, correct physical Caller ID, trunk ID and all correlated CEL/CDR events.
- [ ] Classification is evidence-backed: if unknown, **no SashaTel charge**; if verified human, usage calculation agrees with agreed rounding policy and duration.
- [ ] Duplicate/late events, hangup, lost originate response and retries do not redial or double-bill.
- [ ] No fake gateway or mock fallback in staging/production; `LIVE_CALL_DISPATCH=disabled` until explicit verified gating.

## Architecture boundaries

Yandex Cloud staging hosts Backend + private PostgreSQL and optional private ARI transport. The existing Timeweb PBX remains the SIP test endpoint; **do not deploy another PBX just to evade the Timeweb restriction**. A later PBX placement decision must account for UDP port policies, network round-trip time, RTP port range, NAT, carrier allowlist and separate infrastructure cost.

Production remains untouched. Testing with simulated/private ARI fixtures can proceed while SIP ingress is blocked; do not label that a real PSTN pass.
