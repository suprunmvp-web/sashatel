# Validation record — 2026-11-15

Environment: Linux x64 cloud, Node 24.22.1, Electron 45.3.2, Playwright 1.65.1.
Native Chromium enumeration returned **0 inputs, 0 outputs**. No physical
microphone or headphones were available. No macOS machine was used.

## Automatically checked

`cd desktop && npm ci && npm test`

40 passing unit/security tests. Device/TCC failure simulation uses mocks where
cloud hardware and macOS APIs are unavailable. These tests cover:

- Discovery without capture, detached snapshots, broken UI subscriber isolation.
- Denied/restricted OS access, browser denial, no input/output, occupied/missing
  device, empty/non-live stream and sanitized errors.
- Exact input constraint, stable processed output stream on input replacement,
  stopping old tracks and preserving old source on failed switching.
- Measured silence versus signal, repeated tests, pre-gain RMS/dBFS, real graph
  gain/volume values; node, stream, context and timer cleanup.
- Concurrent requests, coalesced devicechange, timeout, late permission/capture/
  playback results, rapid cancellation and permanent disposal.
- Input unplug, explicit input/output loss, context interruption, playback
  element errors, unsupported sinks, failed/timed-out routing and playback.
- Borrowed remote-track ownership, simulated suspend/resume, permission revocation
  after wake, no automatic recapture or playback restart.
- Invalid numeric/ID arguments, exact trusted document, IPC sender/frame/argument
  validation, camera/foreign-origin/subframe denial, local resource allowlist.

`git diff --check` passed. CSS, original renderer/call logic, root web cabinet,
logo and visible DOM remain unchanged; the HTML head only adds the audio module
and stream-media CSP directive. Dependencies are locked. No runtime package was
added; Playwright is a development-only dependency.
`npm audit` reported 0 known vulnerabilities in the locked dependencies.

## Checked in real Electron

`cd desktop && npm run test:electron`

9 passing tests (two parent integration tests and seven nested cases). The
integration runner explicitly sets `chromiumSandbox: true` because Playwright's
default otherwise injects `--no-sandbox`. Application security settings remain
enabled. Linux without a display uses headless Ozone. No production test mode or
permission bypass is added to main/preload.

- Real Electron startup, preload IPC, module/CSP loading and isolation flags.
- Node inaccessible in renderer; external navigation/new windows blocked; service
  still usable after blocked navigation. Native no-device error paths work.
- Chromium's test audio device with a generated 440 Hz WAV passes through the
  **production** permission handlers, `getUserMedia`, native Web Audio analyser
  and destination stream. No fake-UI permission bypass flag is used.
- Three repeated measurements detect actual nonzero PCM samples. A separate
  native analyser on the processed stream confirms gain 1 gives signal and gain
  0 gives silence. These are synthetic samples, not physical microphone sound.
- Real exact-device capture and `setSinkId` accept the enumerated test devices;
  oscillator playback starts. Physical audibility remains unconfirmed.
- Cancellation, competing requests, lease release, service suspend/resume,
  actual closure of owned AudioContexts, camera denial and page reload succeed
  with no renderer `pageerror` events.

## Requires a real Mac

Physical input/output, built-in and USB/Bluetooth devices, TCC prompts and refusal,
privacy indicator shutdown, actual hardware removal, lid sleep/wake, screen lock,
Bluetooth profile changes, and packaged application/helper entitlements.

## Not checked

macOS/Windows execution, signed/notarized DMG, macOS installer/updater, acoustical
latency/quality, long-running hardware soak or native memory profiling, physical
zero-leak claims, and WebRTC/SIP/call lifecycle integration. The packaging config
was supplied but was not built on a Mac. No claim of release readiness is made.

## MacBook Air manual checklist

Use the packaged SashaTel app for TCC identity; also compare `npm start` for
development. There are no audio controls in the audited UI. Until a settings
screen consumes the contract, use View → Toggle Developer Tools (⌥⌘I) and the
following local console commands. Do not copy device lists or diagnostic output
to public reports.

```js
const a = window.sashatelAudio;
const off = a.subscribe(s => console.log({ meter: s.meter, test: s.lastTest, error: s.error }));
await a.requestPermission();
const devices = await a.refreshDevices(); // inspect locally; labels/IDs are private
await a.testMicrophone(); // speak; compare against a silent test
await a.testPlayback();   // personally confirm the 440 Hz tone is heard
```

- [ ] Fresh launch: no microphone privacy indicator or permission prompt until
  explicit test/permission action; original UI and demo calls unchanged.
- [ ] Allow TCC: labels appear, speaking produces nonzero RMS/peak/dBFS and
  `signalDetected=true`; quiet/muted hardware does not receive false success.
- [ ] Deny TCC on fresh app permission state; no hang/repeated prompts. Enable
  access in System Settings, restart if required, then retry successfully.
- [ ] Select built-in/USB/Bluetooth inputs by their `devices.inputs[n].id` using
  `await a.selectInput(id)`; repeat speaking test. Switch during a running test;
  verify new input responds and old capture is released.
- [ ] Select each output with `await a.selectOutput(devices.outputs[n].id)`;
  verify tone actually comes from that device. Test volumes 0, 0.2, 1; set gain
  0, 1 and 1.5 on a lease (gain is software, not System Settings input volume).
- [ ] Remove USB/Bluetooth headset during input/output tests. Test must terminate
  or report device loss; explicit output loss must stop managed playback.
  Refresh/reconnect/select and test again; compare OS-default alias behavior.
- [ ] Open a lease with `const lease = await a.acquireInput()`; switch input,
  then `lease.release()`. The processed stream stays stable until release;
  service-owned tracks end after release. No accidental speaker monitoring.
- [ ] Repeat tests 20 times; quickly call `a.stopTests()` while starting/running.
  Check no stuck tone, stale meter, active privacy indicator or uncaught rejection
  after settled cleanup. A cancelled pending OS prompt may still be visible;
  resolving it must not start capture.
- [ ] Sleep/lid close and screen lock during test and lease; after wake/unlock,
  audio remains stopped. An explicit retry works. Revoke access while asleep
  and verify clear denial after wake.
- [ ] Reload/close/reopen window and minimize during tests; no leftover audio.
  A future settings screen must call `stopTests()` on every unmount/route exit.
- [ ] Trigger simultaneous requests: one starts, the other reports `BUSY`.
  Camera remains denied and external pages cannot replace/open app content.
- [ ] Inspect packaged `Info.plist` microphone description and signed app/helper
  entitlements; verify permission is attributed to SashaTel, not Electron.

Finish with `a.stopTests(); off();`. Record app/OS version and pass/fail per
device type, without recording audio, serial numbers or full device IDs.
