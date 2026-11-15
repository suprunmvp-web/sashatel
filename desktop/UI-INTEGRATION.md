> Исторический документ независимого PR #8. Текущая интеграция: [docs/desktop-integration.md](../docs/desktop-integration.md).

# Desktop UI integration boundaries

Base: `feat/desktop-softphone-v1` `139b121`. This PR intentionally targets that branch: `main` only contains the web cabinet. Do not merge this UI branch, PR #2 or PR #3 without Tech Lead review. No Core, Audio Device Service, Backend or Asterisk implementation is changed here.

## Composition and ownership

`renderer.js` is the only composition root. `src/contracts.d.ts` defines the view ports; `controller.js` holds screen/input/command-pending presentation state; `view.js` renders and subscribes. `format.js` provides display helpers and the existing RU-only demo input policy. Production number validation remains authoritative in Core.

The isolated demo adapter is **not a second production lifecycle**. It has no transport, deadlines, retries, capture, billing or automatic answer. Replace its injection when Core + real SIP transport are ready. Never wrap a fake transport as `mode: 'live'`.

## CallPort → shared Core

Read the actual shared API from `packages/call-lifecycle/src` in PR #2 / `feat/call-lifecycle-core` (`1655e7e` inspected). The production facade should:

- Forward `start(raw)` and `endCall(callId)` results without optimistic success. Forward subscriptions and read `getSnapshot()` initially: Core subscriptions do not send an initial callback.
- Expose the same `state`, `callId`, `number`, `canStart`, `durationMs`, `connectedAt`, `reason`. Add `connection` only from the actual SIP registration/transport owner; do not infer registration from call state or a resolved start command.
- Use one owner for the call and one canonical Core import. The view never recreates Core to clear a failure. Core's `canStart=false` stays authoritative, including terminal quarantine after unconfirmed cleanup.
- Preserve Core-owned monotonic duration. The view's 250 ms repaint reads `getSnapshot().durationMs` and never starts or advances call states. Repainting alone cannot confirm an answer.
- Return sanitized user-facing command errors. UI uses textContent and does not expose native exceptions. Lifecycle ownership, disposal, reattachment after reload, cross-window arbitration and SIP cleanup belong to the integration owner, not view unmount.

History classification requires a finite non-negative `connectedAt` from the service, including zero. An `ended` state, hangup reason, positive duration or a previously rendered active screen is not answer evidence. Before confirmation, local cancellation/hangup maps to `cancelled`, no-answer/early remote hangup to `missed`, and disposal/unrecognized reasons to `unknown`; failures remain `failed`. Unconfirmed duration is zero. `HistoryItem` is a discriminated union: `answered` requires numeric answer evidence.

Controller records **only demo** terminal events into demo history. Live history must come from Backend through `HistoryPort.load()` and the existing history refresh/retry controls. It must return Date objects in the UI facade, stable IDs, mode, number, status, answer evidence (`connectedAt`) and duration; map unsupported/missing answer evidence to an honest unknown status. No client-generated billing/CDR. Server limits and permissions should arrive as sanitized command errors; no client-side implementation of the eight-call rule.

## AudioPort → existing Audio Device Service

PR #3 / `feature/desktop-audio-foundation` `cadb039` was inspected read-only. `src/audio-facade.js` is only a field/method translator for the public service; it does not use mediaDevices, AudioContext, streams, tracks, oscillators or device discovery. `renderer.js` uses it when `window.sashatelAudio` is already provided; otherwise it uses the explicit unavailable port.

| UI | Existing public service |
| --- | --- |
| getSnapshot / subscribe | getState / subscribe (immediate callback supported) |
| inputs/outputs | devices.inputs/outputs; selectable only plus explicit OS-default option |
| permission | permission (unknown/granted/denied/restricted) |
| outputSelection | capabilities.outputSelection |
| level | meter.rms, bounded 0–1; no synthetic meter animation |
| testing speaker | testing playback |
| selectInput / selectOutput | same methods |
| volume | setPlaybackVolume; app playback gain, not OS volume |
| testMicrophone / testSpeaker | testMicrophone / testPlayback |
| stopTest | stopTests (does not dispose the shared owner) |
| requestPermission | requestPermission, from a user gesture only |
| result | lastTest.reason + signalDetected; playback does not assert physical audibility |
| message | stable error code mapped to short Russian text |

Diagnostic promises can remain pending while a test runs. Stop remains available; navigation/unmount calls stopTests; a late completed UI action triggers another stop if the settings screen is gone. The view does not dispose the shared audio service or terminate SIP because audio failed. UI tests inject service doubles only into a separate test fixture, not production composition.

Integration prerequisites belong to the Audio task (Issue #5):

1. Load its bootstrap module before the UI composition root, keeping a single service instance. Do not open capture on startup.
2. Resolve overlapping `main.cjs`/`preload.cjs`/`package.json`/README changes deliberately: retain the Audio branch's owning-frame IPC checks, permissions, TCC metadata, lifecycle hooks, sandbox and CSP; apply this PR's compact window and UI assets. There is no new general IPC in this UI PR.
3. Replace its hardcoded local resource list with the secure extensible policy under review in Issue #5. It must admit `src/*.js`, `src/tokens.css`, `assets/sashatel-logo.svg` while still rejecting traversal, symlinks escaping the app, tests, main/preload and external URLs. This UI PR neither edits `security.cjs` nor widens network/media permissions.
4. Follow the Audio service's synthetic Electron tests and physical macOS checklist. A disabled setting here does not mean the independent service has not been implemented; it means the reviewed service/security integration is not present on this base branch.

## Tech Lead decisions before integration

- Official SVG asset, published Core facade/error contract from Issue #4, and reviewed Audio security/resource contract from Issue #5.
- Single owner/process lifecycle and real transport registration source; production history/auth API.
- Resolve the independent branches' Electron package/build/security edits; choose the release packager. This UI's unpacked host build is for review, not a signing/notarization pipeline.
- Verify minimum content size and macOS traffic-light/titlebar behavior, Retina zoom, VoiceOver, keyboard clipboard, real TCC and USB/Bluetooth hot-unplug, sleep/wake and a packaged app. Cloud Linux screenshots do not validate any of those physical/macOS behaviors.
