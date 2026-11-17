# Web onboarding review proposal

Scope: registration, verification code, welcome, wait for invitation, INN lookup, organization confirmation, UUID cabinet, login/logout. Separate branch; no Desktop or admin changes.

Run from repository root with `python3 -m http.server 4173`. Open `/brandbook/onboarding/?preview=1`. This explicitly labelled fixture sends no email and does not call DaData. Use code 123456 and INN 7707083893. Scenario controls expose delivery/rate/code/lookup/network/ambiguous-create/session failures. Without preview=1, registration fails closed because AUTH-01 is not implemented. The root landing and production hosting configuration are unchanged.

Source design: brandbook AI_DESIGN_STANDARD.md, icon-registry.json, style.css, first-launch.css, icons.js; owner screenshot 2026-11-16 04.07.44. Reuses neutral tokens, Geist/Geist Mono, Lucide registry and thin separators. Georgia is limited to the welcome greeting. Explicit current product decision removes particles and legacy demo navigation. Screens are a proposal pending product acceptance.

Backend dependency: PR #14 docs/backend/account-session-contract.md (AUTH-01 / SESSION-01 / ORG-01). Web uses server-owned account/organization/owner semantics and HttpOnly same-origin cookies. Production integration waits for implemented register/verify/resend/account/login/refresh/logout/lookup/create/context endpoints, CSRF bootstrap contract, challenge resume and delivery status. No bearer, refresh or password is stored in browser storage. Preview stores only labelled non-secret fixture metadata in sessionStorage; it resets when the tab closes. Only theme preference uses localStorage. Preview passwords are discarded and not validated against an account store.

Challenge timers come from preview API response using proposed backend values 600/60, not UI constants. The preview's 12-character password minimum is a proposal awaiting Backend policy. Verification errors deliberately use the contract's combined CODE_INVALID_OR_EXPIRED response. Lookup/create errors and delivery states remain contract candidates until backend confirms wire semantics. Create uses one idempotency key per lookup across retries; double submit is blocked. Organization URL grants no authority; the preview validates its fixture ID, but real tenant isolation must be tested against Backend. Logout clears preview authorization. Reload resumes a challenge or signed-in fixture; a closed-tab return requires login. Production refresh, browser restart, cookie/CSRF and cross-tenant acceptance are blocked on real API.

Do not deploy this directory as a production service. The proposed landing integration is a link from sashatel.ru to platform.sashatel.ru; review preview is isolated at /brandbook/onboarding/.

PR preview uses the existing Vercel brandbook root at `/onboarding/?preview=1`. This adds a separate path and preserves the root brandbook. Production deployment is outside this task.
