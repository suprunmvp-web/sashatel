# MacBook Air smoke check — no certificates or secrets required

Status: **not executed on a real Mac**. Cloud PCM tests use synthetic devices;
simulated disconnect/TCC/sleep events do not prove macOS or Bluetooth behavior.
This checklist is a test procedure, not a request for credentials/signing keys.
Use only local audio tests; no SIP calls, backend or Asterisk.

## Prepare and package

Record macOS version, Mac model/architecture, commit SHA and device **types**
(built-in, USB, Bluetooth). Do not publish serials, device IDs, recordings or
full diagnostic dumps. Quit other apps using the microphone. Start at low volume.

```sh
cd desktop
npm ci
npm test
npm run test:electron   # synthetic API checks, not physical audio verification
npm start              # development host; TCC is attributed to Electron
```

For a local **unsigned** app bundle, without account, certificate or notarization:

```sh
CSC_IDENTITY_AUTO_DISCOVERY=false npx --yes --package electron-builder@26.18.0 \
  electron-builder --mac --dir --arm64 -c.mac.identity=null
```

Use `--x64` on Intel. This does not produce a signed/notarized distributable.
If the OS refuses the local unsigned bundle, record that result; do not disable
Gatekeeper or change global security settings to make the test pass. Source-mode
checks can still run, with packaged TCC identity marked **blocked/not checked**.
Signing/distribution verification is a separate release task, not a prerequisite
to recording the physical/source smoke checks. Do not enter Apple credentials.

Confirm the package has the expected metadata/assets (adjust path for actual
builder output):

```sh
APP_PATH="$PWD/dist/mac-arm64/SashaTel.app"
/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP_PATH/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Print :NSMicrophoneUsageDescription' "$APP_PATH/Contents/Info.plist"
```

Expected identity `com.sashatel.desktop`, nonempty microphone explanation.
Unsigned code has no signed entitlements to inspect: mark helper entitlements
**not checked**. For an already signed/ad-hoc build, `codesign -d --entitlements :-`
can inspect app and helper entitlements without any secret; record which identity
was actually tested. Do not call an unsigned source/bundle test release validation.

## Observe safely in the unchanged application

There are no audio controls in this base renderer. View → Toggle Developer Tools
(⌥⌘I) can exercise the public service until Cloud UI binds it. Inspect locally:

```js
const audio = window.sashatelAudio;
const unsubscribe = audio.subscribe(s => console.log({
  operation: s.operation, capture: s.capture, meter: s.meter,
  test: s.lastTest, permission: s.permission, error: s.error
}));
```

Each async command must be awaited/caught. Check `reason` in addition to meter
success. Privacy-indicator shutdown can be delayed briefly by macOS; record
measured delay rather than declaring success immediately after Promise resolution.

| Check | Action | Pass evidence |
| --- | --- | --- |
| Startup | Launch source and local bundle separately | No mic prompt/indicator or tone before explicit request; original dialer unchanged |
| TCC allow | `await audio.requestPermission()`; allow system prompt | Permission becomes granted, temporary capture stops, named devices appear after refresh |
| TCC deny | Deny on fresh permission state (or toggle Microphone in System Settings) | Structured `PERMISSION_DENIED`, no hang/repeated prompts; settings remain usable |
| TCC recovery | Enable access in System Settings, relaunch if macOS requires; explicitly retry | Capture works after explicit action; no background recapture |
| Real input | `await audio.testMicrophone()` while speaking, then while quiet/hardware-muted | Nonzero PCM levels and `signalDetected` for sound, no fabricated success for silence; termination reason shown |
| USB/Bluetooth input | Refresh; select each input ID locally; repeat speaking tests | Selected physical mic responds; old input is released after switching |
| Input removal | Unplug USB/disable Bluetooth during test and during a lease | Device-loss/interruption reason, processed tracks end, `lease.closed` resolves; no auto-reopen |
| Real output | `await audio.selectOutput(id)`; `await audio.testPlayback()` | Personally hear 440 Hz only on selected output; unsupported routing reports a structured error |
| Volume | Set 0, 0.2, 0.7 and repeat tone | Muted/changed audible loudness; system volume itself unchanged |
| Output removal | Remove explicitly selected USB/Bluetooth output during playback | Playback stops/detaches; no silent switch to built-in speakers; reconnect requires explicit selection/retry |
| Default aliases | Test `selectInput('')`/`selectOutput('')`; change OS default | Record actual OS routing separately; aliases may move without a unique device-loss event |
| Repeated tests | Run 20 mic/tone tests; rapidly call `stopTests()` during startup and while active | No stuck tone/meter/indicator, stale Promise writes or unhandled rejection |
| Lease/replacement | Acquire lease; switch input while live; release twice | Processed stream stays stable across switch, old raw source stops, release is idempotent |
| Sleep/lock | Hold lease/test; close lid, lock, sleep/wake/unlock in both orders | Owned audio released; service remains suspended until sleep **and** lock clear; no automatic audio restart |
| Recovery/revoke | Revoke access while app inactive; wake/reopen and retry | Current denial reflected, no stale granted/capture state |
| Window lifecycle | Minimize during test; reload/close/reopen | Test stops, fresh instance idle; original UI remains unchanged |
| Media/Core boundary | Observe `lease.closed` during loss/sleep/release | Media reason only; no fabricated SIP hangup/terminal history event |
| Local assets/package | Inspect packaged assets; load app and modules | No missing local module/CSS/SVG from the real package; network/inline/foreign-file loads remain denied |

For a lease:

```js
const lease = await audio.acquireInput();
const closed = lease.closed;  // inspect after disconnect/sleep/release
lease.release();
await closed;                // media lease termination, NEVER SIP-ended proof
```

Software gain can be verified by attaching a second native Web Audio analyser to
`lease.stream` (with a zero-gain physical output to avoid monitoring). Compare
gain 1 and gain 0; gain 0 must yield silence in the processed stream, while the
service's pre-gain input meter can still see sound. Automated Electron tests
demonstrate this exact measurement; system mic sensitivity must not change.

Finish with `audio.stopTests(); unsubscribe();` and release all held leases.
Record each row as **PASS / FAIL / BLOCKED / NOT CHECKED** with observed outcome,
device type, source/bundle identity, app commit and OS version. Bluetooth failure
may present as track-ended, context interruption, vanished ID or playback error;
record the actual signal rather than inventing an OS event. There is no universal
API proof of physical audibility or every Bluetooth profile transition.
