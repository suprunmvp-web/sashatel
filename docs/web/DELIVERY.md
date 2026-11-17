# Web delivery contract — first platform slice

UI branch/PR -> Vercel preview for visual review -> integration build pinned to UI + Backend SHAs -> YC staging with real API/PostgreSQL. No feature-branch production deploy. Draft PR24 stays separate from Backend14 and DevOps23/25.

## Reproducible build and routing

- Node24.22.1 target (build uses only Node APIs, no npm runtime dependencies). Repository root: node web/build.mjs. Result: web/dist.
- Build includes the approved registration style/fonts and icon registry implementation from brandbook as source assets; the PRODUCT URL is never /brandbook/onboarding/. The old isolated proposal stays archived and is not the platform entrypoint.
- Static ES modules, absolute /assets imports, no runtime CDN. version.json records UI commit and integration Backend pin6e01c154a53759e3a122c56226dd835a6e079313.
- Same-origin /v1/* only. No browser bearer/refresh/password storage. WEB_API_UPSTREAM is a SERVER-side development/proxy variable, never a browser URL/token. Backend WEB_ORIGIN must equal the external exact HTTPS origin. API responses, cookies and Retry-After must pass unchanged; never rewrite API errors to index.html.
- /, /register/, /login/, /recovery/, /admin/, /admin/employees/, /{organization_uuid}/ and nested sections: serve index.html on direct open/reload. /assets/* missing file ->404. UUID grants no authorization; real context selection is POST /v1/session/organization, then server scope checks on every data API.
- Local server: WEB_API_UPSTREAM=http://127.0.0.1:8080 node web/serve.mjs, PORT default4174. It binds loopback. Production uses DevOps TLS/proxy, not this local server.
- Vercel NEW preview project or preview-only project configuration: root repository, build node web/build.mjs, output web/dist, use web/vercel.json as project config. Do not change the existing brandbook root/production deployment. Vercel without staging upstream is visual review using explicit ?preview=1. Default API failure is honest503/no fixture fallback.
- YC: serve immutable dist behind the same origin as pinned Backend. nginx.conf is an example routing fragment; DevOps owns TLS, upstream/DNS, registry/artifact digest, deploy/release lock, DB migrations and tested rollback. Keep old UI artifact+Backend digest+schema compatibility to roll back. New Backend migrations must never be implicitly rolled back with UI.
- Integration workflow checks Backend out into an isolated directory at the exact pin, never merges or mutates its branch. PostgreSQL17 is disposable. Actual WebAuth/createApi are used; mail/DaData test ports are isolated test providers, NOT live email/DaData evidence.
- S1 one Backend replica, strict refresh/reuse and server in-process single-flight. Navigator Locks reduces same-browser races; it does not replace distributed BFF coordination before scale-out.

## Modes and release gates

Explicit ?preview=1 alone enables fixture shell/data. It cannot be enabled by network failure. Platform shows a fixture marker; approved auth appearance remains unchanged. Default mode always uses HTTP. Missing features are disabled/unavailable, never local-success mutations.

Internal UI roles are fixture-only until Backend publishes internal actor/scope bootstrap. A normal account cannot obtain platform roles from URL/query. Service access must retain actual SashaTel actor and server scope; real internal access is currently unavailable. Fixture service banner is labelled. Contacts never enter analytics, logs, CRM or Telegram.

Consent controls are a design proposal, NOT register wire or durable legal acceptance. Backend register sends exactly first_name,last_name,email,phone,password. Marketing is optional; current preview/test is not production legal acceptance. Real document IDs, immutable versions/URLs, legal basis and server receipts remain a production gate. No legal texts/versions invented.

No Web dialler, live SIP/ARI/PSTN, Desktop/admin privilege shortcuts or CRM contact exports.

## Screen -> API -> readiness

| Screen | API source | Current readiness |
|---|---|---|
| Registration/code/login/logout | auth csrf/bootstrap/register/challenges/verify/complete/resend/login/refresh/logout | Backend6e01c154 implemented; HTTP adapter and UI wired; CI integration required |
| Organization lookup/create/select | organizations lookup/create/creation-status/list; session/organization | Backend6e01c154 implemented; same-key recovery and context selection wired |
| Password recovery | password forgot/verify/reset | UI unavailable state; runtime not implemented |
| Statistics | tenant aggregates, period/employee/trunk filters, outcome/source semantics, CSV | Shell/filters/KPI/empty chart; Backend wire needed |
| History/call card | Web session-scoped calls, recording grant, transcript/summary/status, technical details | Shell/table/detail tabs; pilot bearer calls MUST NOT be reused as Web authorization |
| Trunks/management/numbers/information | Web session-scoped UIS CRUD/provisioning/numbers/diagnostics/eligibility | Shell/forms/tabs; pilot bearer API not cookie-compatible, actions disabled |
| Employees | scoped members/invitations/roles/presence/contact DTO | Table/form; Backend wire needed; preserve owner protections |
| Integrations | scoped OAuth binding/webhook deliveries/secrets | Shell/create types; unavailable until real Backend |
| Billing | balance/ledger/documents/invoice/download grants/optional limit | Single page; no invented0 balance/documents, no financial writes |
| Profile/security/organization | account bootstrap; credentials/session list; org mutation+verification gate | Own profile reads bootstrap; write routes unavailable |
| Admin overview/client/service access | internal actor/role/scope, filtered org stats/list, internal create/context | Shell/fixture; live denied until server capability proof |
| Admin staff and financial actions | internal employees/assignments; audited credit/debit/limit/date/verify with versions/idempotency | Confirmation UI; writes disabled; manager cannot change date/staff rights |

Next slices connect one agreed endpoint group at a time; no giant all-platform claim. Availability of contacts is not permission to modify another person's credentials. Legacy NULL fields remain honestly absent.
