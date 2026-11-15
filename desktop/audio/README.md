# Audio Device Service

Renderer-only ES module: `audio-device-service.mjs`. It has no dependency on UI,
call lifecycle, SIP, storage or a framework. `bootstrap.mjs` creates one instance
at `window.sashatelAudio`. Startup only enumerates devices; it never opens a
microphone or prompts for access. No design, layout, CSS, logo, dialer or call
business logic has changed. The existing call remains a silent simulation.

## Audit and scope

Base: `feat/desktop-softphone-v1` at `139b121`. `main` had only the web cabinet,
not an Electron application. This branch is based on the existing desktop branch,
without merging any other work.

Before this change:

- `main.cjs` opened a local file with isolation, sandbox and web security enabled,
  disabled Node integration and denied all Chromium permission requests.
- `preload.cjs` exposed only demo mode/version; no IPC existed.
- `renderer.js` simulated dialing/answer/duration with timers and kept history
  in memory. No audio was simulated or real: there was no capture, enumeration,
  routing, gain, playback, meter, WebRTC or resource manager.
- Electron 45.3.2 was the only dependency. No tests, lockfile, permission-check
  handler or macOS packaging metadata existed.

The root web cabinet and call renderer are outside this change's scope.

## Ownership and layers

| File | Responsibility |
| --- | --- |
| `devices.mjs` | Enumeration, safe unnamed-device labels, ID validation |
| `permissions.mjs` | OS permission bridge; browser grant is established by capture |
| `resources.mjs` | Bounded native operations, cancellation, late-stream disposal, graph cleanup |
| `errors.mjs` | Stable error codes without native error text or device diagnostics |
| `audio-device-service.mjs` | Selection, leases, processing, tests, state, recovery |
| `bootstrap.mjs` | Renderer owner, page/visibility lifecycle |
| `../preload.cjs` | Three narrow audio bridge methods, no general IPC primitive |
| `../main.cjs`, `../security.cjs` | macOS TCC, audio-only Chromium permission policy, trusted frame/IPC/resource allowlists, power events |

The service owns every capture and generated stream, node, context, timer and
listener it creates. Call adapters borrow the processed input stream. Incoming
remote tracks passed to `attachPlayback` belong to the transport: the service
detaches playback but never stops these tracks.

Input graph: `getUserMedia -> source -> analyser -> GainNode -> MediaStreamDestination`.
The microphone is never connected to the physical speakers (no monitoring/feedback).
The analyser measures input **before** gain. The output stream includes software
gain. Replacing a live input reconnects the source and stops the old raw tracks,
while preserving the destination stream/track for a future WebRTC sender.
Failed replacement preserves the original source and selected ID.

Output test: `440 Hz oscillator -> 0.12 GainNode -> MediaStreamDestination -> Audio`.
The HTML element applies the selected sink and the user's playback volume.
There is no network request, downloaded sound, recording or saved audio.

## Public interface

Import `AudioDeviceService` from `./audio-device-service.mjs`, or use the renderer
singleton. Dependencies can be injected for unit tests; production uses native
`navigator.mediaDevices`, `AudioContext`, `Audio` and the isolated preload bridge.

| Method | Contract |
| --- | --- |
| `getState()` | Detached structured-clone snapshot, safe to change locally |
| `subscribe(listener)` | Immediately supplies a snapshot; returns unsubscribe; listener exceptions are isolated |
| `refreshDevices(): Promise<{inputs, outputs}>` | Refreshes devices and OS status; reconciles removed devices; never starts audio |
| `requestPermission(): Promise<'granted'>` | User-initiated OS + Chromium permission request; opens and stops a temporary default input, then refreshes labels |
| `selectInput(id): Promise<void>` | `''` means OS default; explicit ID must exist; applies to current and future capture |
| `selectOutput(id): Promise<void>` | `''` means OS default; uses `setSinkId` for managed output elements; stops playback on failed/uncertain routing |
| `acquireInput(): Promise<{stream: MediaStream, release(): void}>` | Exclusive processed input lease; caller releases it in `finally`; release is idempotent |
| `setInputGain(value): void` | Finite linear gain 0–2, applies to actual processed stream; 1 = unity, 0 = silence |
| `setPlaybackVolume(value): void` | Finite 0–1, applies immediately to managed elements; does not change system volume |
| `attachPlayback(element, remoteStream): Promise<detach>` | Routes, applies volume, attaches and plays a borrowed stream; detach is idempotent |
| `testMicrophone({durationMs=3000}?): Promise<result>` | Duration 200–10000 ms; sample meter every 50 ms; exclusive with input lease/other tests |
| `testPlayback({durationMs=1000}?): Promise<result>` | Duration 200–5000 ms; actual bounded 440 Hz tone; exclusive with another test |
| `stopTests(): void` | Immediately cancels pending diagnostics and releases running tests; does not stop a transport input lease |
| `suspend(): void` | Cancels all pending work, releases owned audio and detaches borrowed playback |
| `resume(): Promise<devices>` | Re-enumerates and checks OS permission; never restarts capture/playback |
| `dispose(): void` | Permanent, idempotent shutdown; releases everything and removes subscriptions |

`id` is an opaque string from the current device list (maximum 1024 characters,
no control characters). Do not persist it or assume it remains stable after TCC
changes, OS updates or reconnection. Empty IDs returned before permission are not
selectable. `''` is the service's explicit default choice, distinct from a device
whose Chromium ID is `'default'`.

Invalid synchronous arguments throw `AudioDeviceError`. Async failures reject
with the same error type (`error.code`); UI must handle rejection. A test that has
started resolves with a termination `reason`, including cancellation or loss of
device. Cancellation while starting rejects `CANCELLED`. Test completion is not
equivalent to signal detection or physical audibility.

### State and objective input evidence

State includes:

- `devices.inputs/outputs`: `{id, label, selectable}[]`.
- `permission`: effective capture result (`unknown`, `granted`, `denied`,
  `restricted`); OS denial overrides the last grant.
- `systemPermission`: native macOS TCC status (`not-determined`, `granted`,
  `denied`, `restricted`, `unknown`); `unknown` on other systems. An OS grant
  alone is not proof of a successful Chromium capture.
- `inputId`, `outputId`, `inputGain`, `volume`.
- `capabilities.outputSelection`, `systemMicrophoneGain=false`,
  `softwareInputGain=true`. Output selection is feature detection, not proof
  that a particular device accepts routing.
- `testing`: `null`, `microphone` or `playback`.
- `meter`: `null` or `{rms, peak, dbFS, signalDetected}` from current PCM frames.
  Silence has `dbFS=null`, avoiding non-finite values in UI/serialization.
- `lastTest`: the most recent completed/interrupted test result.
- `error`: `null` or `{code}`. No raw native messages, stack traces, audio,
  device IDs or labels are logged, transmitted or persisted by the service.
  Device lists are intentionally available locally to the settings UI.

Microphone result:

```js
{
  kind: 'microphone', frames, signalFrames, maxRms, maxPeak,
  signalDetected, elapsedMs, reason
}
```

`signalDetected` requires at least three measured frames above **−50 dBFS** RMS.
It proves non-silent digital input during the test, not speech, the identity of
the microphone, calibration, intelligibility or acceptable acoustic quality.
Silence is never converted into a random or timer-based positive indicator.
The UI should display a live level and a result such as “Сигнал обнаружен” or
“Сигнал не обнаружен”; it must also display an interrupted termination reason.

Playback result is `{kind:'playback', reason, playbackStarted:true,
audibilityConfirmed:false}`. A successful `play()` is not proof of physical
audibility. Ask the user whether the tone was heard; never automatically assert it.

### Errors and concurrency

`PERMISSION_DENIED`, `NO_INPUT`, `NO_OUTPUT`, `DEVICE_UNAVAILABLE`, `DEVICE_LOST`,
`OUTPUT_SELECTION_UNSUPPORTED`, `UNSUPPORTED`, `AUDIO_INTERRUPTED`, `AUDIO_FAILED`,
`TIMEOUT`, `CANCELLED`, `BUSY`, `SUSPENDED`, `DISPOSED`, `INVALID_ARGUMENT`.

Only one setup/selection/discovery operation runs at a time; concurrent requests
reject `BUSY` instead of queuing stale user actions or opening duplicate capture.
The UI should disable duplicate setup actions while pending. Metering/testing
does not retain this lock, so active device selection remains possible.
`devicechange` during a pending operation coalesces into a subsequent refresh.
Native async operations are bounded (12 s by default); OS prompts cannot be
programmatically dismissed. Late capture results are stopped, late playback is
paused/detached. No automatic retry loop or background permission prompt exists.

`devicechange`, input track `ended`, context interruption and media-element
`error` release affected resources. Removal of an explicit output ID stops
playback instead of silently routing private audio to speakers. The OS default
can itself move between physical devices; browsers cannot guarantee detecting
every physical endpoint change behind that alias. Choose an explicit ID when
that distinction matters. A default input whose underlying track ends is stopped.

Power/lock events release transport leases too. The transport must observe state
errors, end or pause sending as its lifecycle requires, and explicitly reacquire
after recovery. The service does not alter the call lifecycle or resurrect calls.

## Connect existing UI (no new UI in this branch)

The audited desktop has no audio settings or test controls. This change only
loads the service; it does not repurpose dialer buttons or add elements. A future
settings screen can bind its existing controls to this contract:

```js
const audio = window.sashatelAudio;
const unsubscribe = audio.subscribe(renderExistingAudioState);

async function testFromUserGesture() {
  try {
    const result = await audio.testMicrophone();
    renderExistingTestResult(result); // signalDetected + reason, not just resolved Promise
  } catch (error) {
    renderExistingAudioError(error.code);
  }
}

// On leaving the audio settings screen (including fast route transitions):
function unmountAudioSettings() {
  unsubscribe();
  audio.stopTests(); // do not dispose the application-owned singleton here
}
```

Bind selectors to `selectInput`/`selectOutput`, volume to `setPlaybackVolume`, and
software gain to `setInputGain`. Hide/disable explicit output choices when
`capabilities.outputSelection` is false; retain OS default playback. Label gain
as software gain, not system microphone sensitivity. Handle every Promise and
show meaningful messages for the error codes. Do not log snapshots/device lists.

WebRTC integration contract, **not implemented in this branch**:

```js
async function withAudioSession(peerConnection, runSession) {
  const lease = await audio.acquireInput();
  try {
    const [track] = lease.stream.getAudioTracks();
    const sender = peerConnection.addTrack(track, lease.stream);
    // selectInput() preserves this processed destination track while replacing input.
    // Application lifecycle owns sender/peerConnection and handles interrupted leases.
    await runSession({ sender, stream: lease.stream }); // resolves at actual session end
  } finally {
    lease.release();
  }
}

const detach = await audio.attachPlayback(existingAudioElement, remoteStream);
// At actual transport end:
detach(); // transport itself owns/stops remote tracks and closes the peer connection
```

The current CSP/network allowlist deliberately blocks network connections. A real
WebRTC/SIP integration needs a separate review of allowed signaling/ICE endpoints,
autoplay, sender lifecycle and recovery. No SIP dependency or business logic has
been added here. Do not manually stop or close service-owned destination tracks
and contexts; use the lease/service lifecycle methods.

## macOS capabilities and limits

- Native TCC status/request uses `systemPreferences`. Denied/restricted access
  fails without reprompting. The user enables microphone access in System
  Settings → Privacy & Security → Microphone; macOS may require app restart.
- Chromium accepts only microphone media access from the application's main
  frame and exact entry document. Camera, screen capture, foreign origins,
  subframes and all other permissions remain denied.
- Standard Chromium enumeration/capture and feature-detected `Audio.setSinkId`
  are used. Unsupported explicit output selection fails honestly; default output
  works where an output device is available. Non-default devices/labels may be
  hidden until microphone permission is granted; refresh the list afterwards.
  No native CoreAudio extension exists.
- Software input gain operates only on the processed stream returned by the
  service. It does not change hardware gain or affect raw captures made elsewhere.
  Gain above 1 can clip; it is not a quality improvement or an OS mixer control.
  Browser/driver echo cancellation, AGC and noise suppression may precede it.
- Bluetooth profile changes, device driver behavior and OS default aliases are
  platform-controlled. No promise of seamless Bluetooth switching, zero latency,
  acoustically calibrated metering or continuity through sleep is made.
- No system output volume, system mic gain, loopback capture, recording,
  persistent device preference, background daemon or automatic restart of audio.

`electron-builder.yml` and `build/entitlements.mac.plist` provide app identity,
`NSMicrophoneUsageDescription`, hardened runtime, JIT and microphone entitlement
for the app/helpers. They are packaging inputs, **not a signed/notarized release**.
To exercise a local package on a Mac with signing credentials configured:

```sh
cd desktop
npm ci
npx --yes --package electron-builder@26.18.0 electron-builder --mac --arm64
```

The optional packager is pinned in this command, not installed into the runtime.
Use `--x64` for an Intel Mac. Signing identity, provisioning, notarization and
Apple distribution credentials remain the release pipeline's responsibility.
Verify the generated app's Info.plist and helper entitlements on a Mac. Source
launches via `npm start` are attributed to the Electron host by TCC, so a packaged
SashaTel run is required to verify the real application permission identity.

## Security

Isolation, sandbox, web security and disabled Node integration are preserved.
IPC accepts no arguments and only the owning main frame at the exact local entry
URL. Preload exposes status, request and a validated lifecycle subscription; it
never exposes `ipcRenderer`, sender events, filesystem, shell or arbitrary
channels. Both Chromium permission handlers use an audio-only policy. Resource
requests use a fixed local-file allowlist; navigation, redirects, new windows
and webviews are blocked. CSP allows local modules and stream media, retaining
`connect-src 'none'` and no inline/eval scripts. Failures are normalized; subscriber
and expected native Promise failures are handled without global exception
swallowing. Renderer process loss destroys the window; macOS activation can open
a fresh one with no active audio. No telemetry has been added.

## Validation

See [VALIDATION.md](./VALIDATION.md) for commands, actual results and the MacBook
Air checklist. Cloud checks do not establish physical microphone/headphone
function, macOS TCC behavior, sleep behavior or a signed release's entitlements.
