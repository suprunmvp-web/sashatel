# Web onboarding review proposal

Scope: registration, verification code, welcome, wait for invitation, INN lookup, organization confirmation, UUID cabinet, login/logout. Separate branch; no Desktop or admin changes.

Run from repository root with `python3 -m http.server 4173`. Open `/brandbook/onboarding/?preview=1`. This explicitly selected fixture sends no email and does not call DaData. Use code 123456 and INN 7707083893. Failure injection is test-only through sessionStorage key `sashatel.onboarding.preview.scenario`; there is no diagnostics UI. Without preview=1, registration fails closed because AUTH-01 is not implemented. The root landing and production hosting configuration are unchanged.

Source design: brandbook AI_DESIGN_STANDARD.md, icon-registry.json, style.css, first-launch.css, icons.js; owner screenshot 2026-11-16 04.07.44. Reuses neutral tokens, Geist/Geist Mono, Lucide registry and thin separators. Owner revision 2026-11-18: auth is always dark, Georgia appears only in first-contact greetings, the former particle experiment is superseded by the final no-particles decision below. Legacy demo navigation stays removed. Screens are a proposal pending product acceptance.

Backend dependency: PR #14 docs/backend/account-session-contract.md (AUTH-01 / SESSION-01 / ORG-01). Web uses server-owned account/organization/owner semantics and HttpOnly same-origin cookies. Production integration waits for implemented register/verify/resend/account/login/refresh/logout/lookup/create/context endpoints, CSRF bootstrap contract, challenge resume and delivery status. No bearer, refresh or password is stored in browser storage. Preview stores only labelled non-secret fixture metadata in sessionStorage; it resets when the tab closes. Only theme preference uses localStorage. Preview passwords are discarded and not validated against an account store.

Challenge timers come from preview API response using proposed backend values 600/60, not UI constants. The 12-character minimum follows the agreed Backend policy; full Unicode/byte validation remains a runtime acceptance item. Verification errors deliberately use the contract's combined CODE_INVALID_OR_EXPIRED response. Lookup/create errors and delivery states remain contract candidates until backend confirms wire semantics. Create uses one idempotency key per lookup across retries; double submit is blocked. Organization URL grants no authority; the preview validates its fixture ID, but real tenant isolation must be tested against Backend. Logout clears preview authorization. Reload resumes a challenge or signed-in fixture; a closed-tab return requires login. Production refresh, browser restart, cookie/CSRF and cross-tenant acceptance are blocked on real API.

Do not deploy this directory as a production service. The proposed landing integration is a link from sashatel.ru to platform.sashatel.ru; review preview is isolated at /brandbook/onboarding/.

PR preview uses the existing Vercel brandbook root at `/onboarding/?preview=1`. This adds a separate path and preserves the root brandbook. Production deployment is outside this task.

## Review checks

Local browser inspection on macOS exercised signup, wrong code, welcome, INN error/recovery, confirmation, empty organization and delivery failure. Local console was clean. The in-app viewport override did not change its measured width, so breakpoint verification is taken from the automated Chromium matrix instead.

GitHub Actions checks all four requested widths in both themes, real browser clipboard paste, Enter submission, focus on errors, password autocomplete attributes and show/hide, cancellation, ambiguous-create retry, duplicate clicks, reload/resume, logout, session expiry, foreign UUID rejection in the fixture and long Cyrillic organization names. It captures screenshots and results.json with the tested commit SHA. Delivery, resend cooldown/recovery, email correction and lookup outages are included. Real password-manager autofill UI, real email delivery, DaData, cookie restoration after browser restart, refresh/CSRF and Backend tenant isolation still require runtime acceptance.

Vercel automatically produces an authenticated PR preview under `/onboarding/?preview=1`; its SSO protection remains enabled. Local browser review uses `/brandbook/onboarding/?preview=1` from the repository-root server. The live landing CTA and production domain routing await acceptance and the Backend.

## Owner design revision, 2026-11-18

Registration now includes first name, surname, email, international telephone and password. Country calling codes are sourced from libphonenumber-js 1.11.20 (MIT); country names use Intl.DisplayNames. Keyboard navigation, search and Escape are supported. Letters are rejected on input and paste. No referral field. Marketing is optional and unchecked; legal consent requires an explicit choice. Auth never exposes the platform theme switch; light platform tokens use neutral graphite rather than brown.

Surname, telephone and consent controls are preview-only pending a Backend DTO extension. They are not sent as unsupported properties or persisted. Legal document URLs/versions and consent receipt semantics are blockers before production. The checkboxes currently illustrate the requested interaction; they do not record legally effective acceptance. Existing wire ACK: PR #14 comment 6962594739. No real email, registration or DaData is enabled. Debug labels are removed at the owner's request; the explicit `?preview=1` boundary and fail-closed default remain.

Vercel preview update is currently blocked by HTTP 402 `api-deployments-free-per-day` (>100/day). Existing Vercel preview is an older commit and must not be used as evidence for this revision. CI artifacts identify the exact tested commit.

## Final wire ACK and runtime gate — 2026-11-18

Owner freezes registration appearance; no particles in Web/Desktop. The former particle experiment is removed. No expansion of fixtures or screenshot scenarios while the real API is pending.

Final Web ACK: Backend 1610d42a2998b07e4042ebdec094d1d6e09fe156, account-session-contract §§16–17: https://github.com/suprunmvp-web/sashatel/pull/14#issuecomment-6963619655 . Section17 supersedes the provisional-family completion proposal in bc8c14e. Register accepts exactly first_name,last_name,email,phone,password, mandatory for NEW registrations. Server validates names and numbering plan, normalizes E.164, stores phone_verified=false. Phone is not an auth/recovery credential. display_name is derived. Legacy names/phone remain nullable without fabricated backfill. Contacts are available only in authorized membership scope; no employee-screen or CRM expansion here, no contacts in analytics/raw logs/Telegram.

Completion TTL5min restores the SAME family from encrypted short-lived receipt with key outside DB. Authenticated bootstrap/logout/new login/register/resend/TTL close it. Empty lookup404 and Organization.verification_status are accepted. Existing §16 CSRF, challenge resume/delivery, corrected-email and same-key organization recovery are accepted.

Consent/news are NOT fields of the agreed register DTO and are not required because of a mock checkbox. Before production, legal must supply actual document IDs/immutable versions/URLs and decide the legal basis. Proposed future acceptance mechanism (not yet agreed wire): server manifest -> explicit user acceptance of id/version -> account-bound server timestamp/purpose/request_id receipt; marketing separate and optional. No legal text or actual document version is invented; preview stays test-only.

At reviewed Backend SHA new auth/onboarding routes are documentation only; backend/http.ts still exposes incompatible pilot POST /v1/sessions. Do not connect the form to that identity model or claim live integration. Implementation SHA, runnable same-origin local/staging API, startup/migration instructions and safe test email sink were requested directly: https://github.com/suprunmvp-web/sashatel/pull/14#issuecomment-6963659695 . Real server validation, persistence after re-login, NULL legacy migration and cross-tenant contact tests are blocked on implementation. Existing preview results do not prove these properties.

Local execution environment disconnected during this update; no fresh local execution or screenshots claimed. GitHub Actions remains the code-check path. No runtime auth switch before real API availability.
