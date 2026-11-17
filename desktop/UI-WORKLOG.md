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


## PR #8 Tech Lead review 5912232629 — 2026-11-15

- Source: https://github.com/suprunmvp-web/sashatel/pull/8#pullrequestreview-5912232629, created 18:41:41 UTC. This is an existing PR correction; no new Issue or PR. Own remote/local head matched `ff54b8e`, working tree was clean and no competing own update was present.
- Defect reproduced: 14 new regression checks failed on the old UI (19 prior unit tests passed). No Core/Audio changes were needed.
- CallSnapshot now carries service-confirmed `connectedAt`; demo snapshots preserve/reset that evidence. History mapping requires a finite non-negative timestamp, accepts zero, distinguishes cancelled/missed/unknown, and keeps unconfirmed duration at zero. The answered HistoryItem variant requires numeric evidence. View labels reflect those distinctions.
- Unit checks now 33; component scenarios now 7, including all five history labels. Electron source/packaged flow now also creates cancelled, missed and confirmed demo calls for the actual history screenshot. Results and capture provenance are maintained in artifacts/README and the PR body.
- This scheduled run successfully resumed the Cloud checkout and executed shell/test commands independently of the owner's Mac. The earlier unresolved environment observation above is historical; it is not a current provisioning blocker. No real SIP or physical audio/macOS proof is claimed.

- Local verification completed: strict typecheck, lint, 33/33 unit tests, 7/7 Chromium scenarios, Electron source E2E, Linux packaging and packaged Electron E2E all passed. Updated actual Electron history/minimum-window captures were visually inspected. Review 5912232629 is implemented in this PR; final GitHub CI evidence is recorded in the PR body after push.


## Product decision #20 — operator availability follow-up, 2026-11-17

- New approved policy: https://github.com/suprunmvp-web/sashatel/issues/20, created/updated 2026-11-16T23:10:42Z; no comments at audit. Earlier #19's Desktop trunk-management suggestion is superseded. Do not reintroduce it on a later scheduled run.
- Own continuation: `feature/desktop-ui-operator-status` from `feature/desktop-ui-cloud` / `156c578`. Parent PR #8 remains unchanged; a separate focused Draft PR will target the own UI branch. This new task is not a repeat of review 5912232629.
- Verified defect in own UI: `registered` was rendered as green “Телефония подключена”, despite no readiness contract. The follow-up retains the legacy port but renders registration as neutral unconfirmed readiness, unavailable/unknown observations as unavailable. No new Backend API, IPC, ready flag, Caller ID feature or trunk controls.
- PR #10 and the integration branch remain owned by Integration Engineer / Tech Lead under #9. Do not perform their administrative-code cleanup in parallel. #20 as a whole is not closed by this indicator correction.
- Regression component test failed on the old UI, then passed after the fix. It checks both themes, neutral text/dot colors, unknown values, and absence of technical/operator administrative controls. The two new screenshots are Chromium UI contract fixtures with a fake port, not Electron/live registration or a real Backend readiness check.

- Final local validation passed: strict typecheck, ESLint, 33 unit tests, 8 Chromium scenarios (including neutral registration/unknown/prototype-key cases in both themes), Electron source E2E, Linux host build and packaged Electron E2E. The two new Chromium contract-fixture captures were visually inspected. Existing nine Electron images are retained as baseline evidence; fresh current-run Electron captures are published by CI. macOS, physical audio, actual registration and Backend readiness remain unverified.
