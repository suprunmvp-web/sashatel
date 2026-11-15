# Desktop UI work log

Use this file with current GitHub issue/comment IDs and PR head SHAs to avoid duplicate automated work. Do not treat an observation as completion of another team's task.

## Initial implementation — 2026-11-15

- Own branch: `feature/desktop-ui-cloud`, based on `feat/desktop-softphone-v1` / `139b121d9e05b0a4bb0b8f1e934f156fd4b7e544`.
- Implemented requested Dialer/Call/History/Settings, tokens/themes, replaceable placeholder asset, UI contracts/demo isolation, tests and evidence. Details in README, UI-INTEGRATION and artifacts/README.
- Read-only observed Core PR #2 / `1655e7e`, Audio PR #3 / `cadb039`. No merge or edit of those modules.
- Read-only observed Issues #4 (Core single-owner/integration contract) and #5 (Audio integration/security/Mac). Both are **external dependencies**, not completed by this UI branch. The UI facade matches Audio's currently published public API; Issue #5 may revise it.
- Tech Lead review on PR #3 (`5911936607`) identifies hardcoded security.cjs local allowlist. Recorded as integration prerequisite; did not rewrite the Audio-owned policy.
- `ui/reference-fidelity` was not a published ref at audit; no local Mac work was accessed or changed.

## Automation boundary

Own Draft PR: https://github.com/suprunmvp-web/sashatel/pull/8. Initial implementation commit: `28d2d83`. First PR workflow run `43743416013` passed typecheck/lint/19 unit tests, then failed before browser tests because ubuntu-latest was 26.04, unsupported by pinned Playwright 1.58. Runner pinned to supported ubuntu-24.04; CI now removes checked-in screenshots before fresh evidence capture. This is a CI compatibility fix, not a new UI task.

The cloud scheduler confirmed an enabled hourly Desktop UI task, with UI-only scope and no merge permission. It returned inherited environment selection with no resolved environment list. Future cloud shell provisioning/autonomous builds are not yet verified; report a concrete blocker if a run has only connector access. Never claim that a scheduled check proves a successful development run.

On subsequent runs first inspect own PR/head, existing workflow status, new UI Issues, review comments and this log. Update the existing Draft PR for the same task; use a new own branch/PR only for a distinct task. Do not duplicate external Core/Audio work or infer task ownership from the shared GitHub username.
