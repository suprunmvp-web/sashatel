# SashaTel — Client activation, Web test call and employee access

**Status:** frontend UX/contract proposal from 22.11.2026. This is not evidence that WebRTC calling, provider provisioning, Gosuslugi integration, staff APIs, or recording are deployed.

## 1. Business process as told by product owner

- Client registers and creates organization.
- SashaTel sells/provides a phone-number pool in CSV form; client must complete the relevant numbering/marking procedure. Exact legal workflow and authorized Госуслуги integration are **not yet verified**.
- After externally confirmed number marking, SashaTel staff complete a separate application, and operator creates SIP trunk with credentials.
- Multiple trunks per organization remain possible. Do not suggest the client can automatically provision an operator's trunk or verify marking by uploading CSV alone.
- Frontend zero-trunk state presents one guided path: prepare numbers → mark → operator provisioning. No artificially completed steps.
- Marking and provider verification statuses must come from authoritative backend/operator events and retain evidence, not client-side completion toggles.

## 2. Browser test call — what it means

- **Placement:** Trunks list, primary top-right call action for a ready connection; same action in the chosen trunk's detail header.
- **Caller:** authenticated org Owner/Admin authorized by tenant RBAC, from verified organization.
- **Preflight:** validate org verification, selected trunk enabled, registration and actual PSTN call readiness, allowed active Caller ID, exhaustion of daily rotation limits, outstanding billing restrictions and current access.
- **Microphone:** explicit user gesture and browser permission via `navigator.mediaDevices.getUserMedia({audio:true,video:false})`, HTTPS secure context. Stop tracks on close/hangup.
- **WebRTC:** requires a separate authenticated signaling service and RTP/WebRTC bridge to Asterisk/PBX (ICE/TURN when needed). A stream of local microphone audio alone is NOT a phone call.
- **From UI:** choose destination phone, show permission/preflight, attempt dialing, ringing, connected, hangup, ended, failure. Remote audio must be routed to an `<audio>` element; do not present connected before server evidence.
- **Server is authority:** chooses Caller ID via normal atomic rotation, enforces max 8 Moscow-day initiations on physical number, validates provider rights, guarantees idempotency and audit, persists trunk_id and caller_id. Never let browser choose raw outbound Caller ID, SIP credentials or bypass limits.
- **History:** same lifecycle as Desktop, persisted `call_id`, events and SIP/CDR/CEL/ARI evidence, recording and analysis (when available), one of existing six outcomes only. Web call source can be metadata, not an invented seventh outcome. History entry must come from server, never fabricated client-side.
- **Lifecycle:** browser closure/loss/reconnect must safely tear down or recover via authoritative server state. Do not assume local hangup success equals call ended.

### Frontend adapter required when Backend is ready

Current frontend `openTestCall({trunk,organization,startCall,onCallComplete})` can take an implementation of `startCall({trunkId,phone,stream,onState,onRemoteStream})`. It must resolve to a session object with `hangup()` and must emit authenticated server-derived state transitions. This is an internal UI adapter contract, **not** an approved REST/WebSocket endpoint specification.

No adapter is currently connected: the Web UI can preflight and test microphone permission, but actual **Позвонить** is unavailable; this is intentional and safer than a fake call.

## 3. Employee lifecycle

- Admin invites by email and selects Employee/Admin role; Owner rights cannot be assigned casually.
- Invitee signs up or accepts into existing SashaTel account, verifies email and establishes their own password.
- Web and Desktop use the same identity, scoped to organizations; multiple org memberships are possible.
- Admin may manage role, revoke membership and sessions if authorized, but cannot read/set anyone else's password. Existing approved owner protection remains.
- Desktop auto-enters dialing after login, SIP credentials are never typed into Desktop.
- Presence is server-derived: offline / online / on call since dialing.
- Audit invitation, acceptance, membership, role and revocation events.
- `openInvite` and `openEmployeeAccess` accept optional backend functions; until those contracts exist the UI shows correct forms and does not report successful sending/saving.

## 4. Product state model

**Loading:** stable skeleton; no flashing empty state.

**Empty:** valid 0 records, contextual single action. Do not show 0% reach without initiations (show em dash).

**Blocked:** human-readable reason and resolution: unverified org, trunk disabled, SIP registered but PSTN unavailable, no allowed Caller ID, microphone denied, or unavailable calling service.

**Error:** toast matching registered auth notifications for transient actions; field error inline; persistent trunk diagnostic stays in Information.

**Success:** only after real server acknowledgement.

## 5. QA and go-live gates

- UI review under an isolated preview build includes sample data; never use its values for production access decisions.
- Visual tests 1440/1024/768/390; both themes; clean first login; list/details; invitations; org switching; CSV format validation; mic/call dialog; no fake dial activation; keyboard and dialog closing.
- Before real calls: deployed signaling + secured transport, permissions audit, end-to-end call, caller ID selection proof, recording/history consistency, timeout/reconnect/hangup, concurrency/rotation tests, external marking provider confirmation.
- Do not merge or promote from Draft until those dependencies are honestly reported and any required release tests pass.
