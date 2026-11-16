# UIS trunk management · v1

Backend and Web SaaS administration contract for #19 and Telephony PR #15. JSON over HTTPS. Use the existing tenant-scoped Bearer session. Tenant identity is derived from the authenticated session. All routes require `trunks.manage`, initially granted to `organization_admin` through the active membership. Read and write rights share this permission in v1.

| Method and path | Request | Success |
| --- | --- | --- |
| POST /v1/trunks | JSON CreateTrunk and required Idempotency-Key | 202 Trunk |
| GET /v1/trunks | No body or query | 200 { "items": Trunk[] } |
| GET /v1/trunks/{id} | UUID path parameter | 200 Trunk |
| DELETE /v1/trunks/{id} | UUID path parameter, no body | 202 { "id": UUID, "deleted": true } |

Schemas below use TypeScript notation for JSON objects. All properties are required unless marked nullable. Additional request properties are rejected.

```ts
type CreateTrunk = {
  name: string;                  // 1–80 trimmed characters
  auth_mode: "registration_credentials";
  registrar_host: string;        // exact DNS hostname on server allowlist
  registrar_port: number;        // integer, exact allowlisted host:port pair
  username: string;              // 1–128 characters, no control characters
  password: string;              // 1–256 characters, no control characters
};
type Trunk = {
  id: string;                    // UUID
  name: string;
  auth_mode: "registration_credentials";
  registrar_host: string;
  registrar_port: number;
  status: "configuring" | "registering" | "registered" | "ready" | "rejected" | "degraded";
  failure_code: "PROVISIONING_REJECTED" | "PROVISIONING_UNAVAILABLE" | null;
  created_at: string;             // ISO 8601 timestamp
};
type Failure = { code: string; message: string };
```

The idempotency key is 1–128 ASCII word characters or `.-:`. Scope is tenant + membership + key. Repeating a matching create returns the same resource and current status; a different request gives 409 IDEMPOTENCY_CONFLICT. A replay of a deleted resource gives 404 TRUNK_NOT_FOUND. Delete hides the resource and revokes eligibility synchronously, queues asynchronous cleanup, then returns 202. Repeated delete returns 202 for the same tenant-owned ID.

401 INVALID_SESSION for absent, expired or replaced sessions. 403 USER_REVOKED / ORGANIZATION_SUSPENDED for blocked actors, 403 TRUNK_PERMISSION_REQUIRED for a valid session without permission. 404 TRUNK_NOT_FOUND for absent or foreign IDs, including invalid UUIDs. 400 INVALID_TRUNK or INVALID_FIELD for schema violations; 400 REGISTRAR_NOT_ALLOWED for a denied endpoint. 413 BODY_TOO_LARGE, 415 JSON_REQUIRED and 429 RATE_LIMITED apply through the common HTTP layer. 503 TRUNK_SERVICE_UNAVAILABLE when secret storage is unavailable. Errors contain stable codes and sanitized messages. Responses never include username, password, encrypted material or secret reference.

## Provisioning contract

- Create stores encrypted credentials, an inactive trunk and one UPSERT job atomically. Delete makes the trunk inactive and queues REMOVE. The idempotency identity for a provisioner is tenant + trunk ID + generation + operation. Retries repeat the identity. A stale result cannot reactivate a deleted or superseded generation.
- Provisioning uses a private adapter. Asterisk receives provisioned credentials through that boundary and has no database access. Plaintext is scoped to the adapter invocation. Jobs carry identifiers and operation; backups/logs/API responses carry no plaintext. The provisioner must use the same registrar allowlist and enforce outbound DNS/IP policy at connect time.
- `configuring` means backend accepted the change, `registering` means the adapter started applying it, `registered` means SIP registration was observed, `ready` additionally requires explicit readiness evidence and the external-call gate. `rejected` is a permanent provider/configuration failure. `degraded` is retryable or indicates lost registration/health. Status alone grants no outbound permission. The backend pilot keeps managed trunks ineligible for real PSTN.
- Transient outcomes retry with exponential backoff. Successful delete removes credentials after provider cleanup. The Web SaaS admin UI can implement create/status/delete against the schema now, with sanitized placeholder fixtures and polling. It should render `registered` and `ready` distinctly.

## Desktop operator boundary

Desktop needs three tenant-scoped read values from an operator API: telephony availability, the allowed or selected outbound Caller ID, and current call eligibility. A status read is advisory. Backend must recheck permissions, limits and routing when accepting a call. Unavailable or unknown eligibility keeps outbound disabled. Administration fields, trunk statuses and credentials stay in the Web SaaS and Backend boundary.

In the reviewed #14 implementation, /health reports process readiness, /v1/sessions issues a token and POST /v1/calls enforces call entitlements. There is no read endpoint returning these three operator values. The existing Desktop call facade can display connection availability and gate start, but there is no live read integration or Caller ID display at this stage. Operator endpoint schema and product UI require review.
