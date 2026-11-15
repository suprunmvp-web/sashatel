# Audio integration contract for Cloud UI and Call Lifecycle Core

Issue #5, additive contract on top of PR #3. This branch implements **no UI or
call adapter**. Do not import main/preload code, open independent captures or
infer call signaling from a microphone test. The typed public interface is
[`audio-device-service.d.mts`](./audio-device-service.d.mts).

## Application owner and state

`audio/bootstrap.mjs` creates the renderer singleton `window.sashatelAudio`.
Screen mounts subscribe; screen unmounts unsubscribe and call `stopTests()`.
Only the application owner calls `dispose()`. Existing lease/stream consumers
continue to work; `lease.closed` and the state fields below are additive.

| State | UI meaning / action |
| --- | --- |
| `operation: null` or setup-operation name | Disable conflicting setup actions while non-null; do not read private `pending` fields |
| `suspended`, `disposed` | Disable capture/tests; disposed singleton must not be reused |
| `devices.inputs/outputs` | Local-only opaque IDs and labels; render via text, never HTML; do not upload/log/persist |
| `permission` | Effective Chromium capture result or overriding OS denial |
| `systemPermission` | macOS TCC status; OS grant alone is not evidence of capture |
| `capabilities.outputSelection` | Feature detection; false disables explicit output selection, retaining default output |
| `capture` | `{status:'idle'|'active'|'interrupted', owner:'test'|'transport'|null, leaseId, reason}`; describes media, never SIP/call state |
| `testing`, `meter`, `lastTest` | Actual diagnostics; do not show success just because a test Promise resolved |
| `error: {code}` | Most recent structured failure; normal device enumeration does not erase it; an explicit setup action or resume can clear it |

`leaseId` is a monotonically increasing number **within this service instance**,
not a device ID or a call/session identifier. It can reset after reload. `capture`
keeps the most recent lease owner/reason after release. Match lease identity when
associating media loss with an adapter; do not treat a historic `interrupted`
snapshot as a failure of a newly created call.

`subscribe` immediately emits a detached snapshot and returns unsubscribe.
Synchronous exceptions and rejected async subscribers are isolated. Prefer a
short synchronous render function; subscribe is not a job queue or an awaitable
event consumer. Input/output graphs are owned by the service, remote stream
tracks by the future transport. `closed` resolves exactly once for that lease.

## Error presentation and retries

| Code | Suggested user message / next step |
| --- | --- |
| `PERMISSION_DENIED` | Microphone access denied. Show System Settings → Privacy & Security → Microphone; retry explicitly after enabling/restart if macOS requires it |
| `NO_INPUT`, `NO_OUTPUT` | No available input/output. Connect a device and refresh |
| `DEVICE_LOST` | Device disconnected. Stop diagnostic display; refresh and explicitly select/reacquire |
| `DEVICE_UNAVAILABLE` | Device unavailable/busy or output failed. Check OS device routing, choose another device and retry |
| `AUDIO_INTERRUPTED` | Audio processing stopped. Explicitly retry after recovery |
| `OUTPUT_SELECTION_UNSUPPORTED` | This platform cannot select this output through the current API; use OS default |
| `UNSUPPORTED` | This environment lacks the required media API |
| `TIMEOUT` | Audio request timed out. An OS prompt can remain open; late capture is disposed, no automatic retry |
| `BUSY` | Another setup operation or exclusive input lease is active. Wait or cancel diagnostics; never cancel a transport lease from a settings screen |
| `CANCELLED` | Expected screen exit/setup cancellation; normally no error banner |
| `SUSPENDED` | Audio unavailable while locked/asleep. Both lock and sleep blockers must clear before retry |
| `DISPOSED` | Application owner shut down this instance; do not retry against it |
| `AUDIO_FAILED` | Audio operation failed. Retry explicitly; do not expose raw OS diagnostics |
| `INVALID_ARGUMENT` | Invalid local control value; fix binding/range rather than retrying hardware |

Synchronous argument validation can throw; wrap the **call itself** in `try`.
Setup failures reject; a running test resolves with a termination `reason`.
Cancellation during its setup stage rejects `CANCELLED`, even if the graph was
briefly active. All branches must handle rejections. Do not retry `BUSY` in an
unbounded loop. Hardware/native operations have a 12 s bound, but an OS permission
dialog cannot be forcibly dismissed by JavaScript.

For input, show RMS/peak/dBFS from `meter` and a final `signalDetected` value
(at least 3 real frames above −50 dBFS). Show the termination reason too. A test
that detected signal and then lost the device is interrupted, not a successful
device-readiness check. Silence yields no success indication. `dbFS=null` is
digital silence. The meter is before software gain. Playback success means only
that Chromium started playback; physical audibility requires the user's answer.

## Bind controls without owning resources

Use `selectInput(id)`, `selectOutput(id)` and `refreshDevices()` for selectors;
`''` means OS default. `setInputGain(0..2)` controls software gain of the returned
processed stream, not System Settings input gain; values above 1 can clip.
`setPlaybackVolume(0..1)` affects managed playback, not system output volume.
Grant permission from a user gesture, then refresh to reveal device labels.

Screen-lifetime pattern (bindings supplied by the UI agent):

```js
const audio = window.sashatelAudio;
let mounted = true;
const unsubscribe = audio.subscribe(state => { if (mounted) renderAudioState(state); });

async function onTestMicrophone() {
  try {
    const result = await audio.testMicrophone();
    if (mounted) renderTestResult(result); // reason AND measured signal
  } catch (error) {
    if (mounted && error.code !== 'CANCELLED') renderAudioError(error.code);
  }
}
function unmount() {
  mounted = false;
  unsubscribe();
  audio.stopTests(); // does not release an existing transport input lease
}
```

Do not dispose the singleton on route change. Do not write into its internal
graphs, timers, `pending`, or state object. Use `getState`/`subscribe` and public
methods. The service configures timers before notifying test-start subscribers,
so immediate unmount/cancellation cannot strand diagnostic timers or a meter.

## Boundary with Call Lifecycle Core

`acquireInput()` returns `{stream, release, closed}`. It owns one processed input
lease; a second capture/test rejects `BUSY`. `selectInput` preserves the processed
destination track while replacing the source. Failed switching preserves the
old source. Disconnect/interruption ends the lease; recovery requires a **new**
lease and the adapter's explicit track/sender handling.

```js
const lease = await audio.acquireInput();
void lease.closed.then(({ leaseId, reason }) => {
  // Adapter-local media status ONLY. release/sleep/device loss is not SIP BYE.
  reportMediaAvailability({ leaseId, available: false, reason });
});
// The future transport uses lease.stream; its own lifecycle eventually calls:
lease.release();
```

`closed` reasons: `released`, `completed`, `cancelled`, `disposed`, `suspended`,
`DEVICE_LOST`, `PERMISSION_DENIED`, `AUDIO_INTERRUPTED`, `AUDIO_FAILED`.
The media contract has **no** `call-ended`, `BYE`, `CANCEL`, billing, finalization
or terminal call-state event. Audio loss may tell the adapter to stop sending,
offer recovery, or request termination through Core's public command API, but
**cannot confirm that termination succeeded**. Only Core's authoritative
signaling/transport evidence may finalize a call. Do not stop call timers,
fabricate hangup confirmation or write completed-call history from an audio error,
test result, lease closure or timeout.

Settings unmount calls `stopTests`, not `release` on the transport lease.
Application lock/sleep/dispose **does** release transport media; signaling may
remain active. `attachPlayback(existingElement, remoteStream)` returns detach;
detach/suspend/disconnect never stop the borrowed remote tracks or close SIP.
This contract does not implement or modify Core and intentionally makes no
assumption about the other agent's current function names.

## New local UI assets and packaging

`security.cjs` allows app-authored `.js`, `.mjs`, `.css`, `.svg`, `.png`, `.jpg`,
`.jpeg`, `.webp`, `.gif`, `.ico`, `.avif` anywhere in the real desktop root except
protected paths. Only the exact entry HTML can be loaded; no additional HTML,
JSON, source maps, CJS/native executables, fonts or media files are authorized.
App-owned JS/CSS/SVG can be added under `desktop/ui/` or `desktop/assets/`
without registering each filename. Dynamic local module imports work.

Denied: external protocols/hosts/UNC paths, outside/sibling paths, malformed or
ambiguous percent escapes, traversal, control characters/backslashes, missing or
non-regular files, symlinks (including links to in-root assets), dotfiles and
protected segments (`node_modules`, `test`, `tests`, `build`, `dist`, `docs`,
`coverage`, `main`, `preload`), `main.*`/`preload.*`/`security.*` and test/spec
sources. Checks include each path component and are repeated per request; an
approved file replaced by a symlink is subsequently denied. URL normalization
by Chromium can remove traversal before the hook, so final filesystem containment
is always enforced independently of the raw URL checks.

These extensions identify **trusted packaged renderer code**, not a sanitizer
for uploads or arbitrary downloaded scripts/SVG. Do not put secrets, downloaded
content, generated executable code or untrusted user files in the asset tree.
The OS must protect the installed application directory. The request hook is not
an atomic filesystem sandbox against a local process concurrently rewriting the
application between check and read; signed/immutable installation is the release
boundary. Hard links to external files are not detectable as symlinks by this
policy; do not ship them. No global filesystem read API is exposed to the UI.

`electron-builder.yml` now includes renderer asset extensions recursively and
excludes private/test/build trees; it still explicitly includes main/preload/
security entrypoints for privileged startup. No UI assets were created in this
branch. Tests create fixtures only in a temporary app copy. Verify a packaged
build contains new assets; filesystem/ASAR behavior on a Mac remains a manual
smoke requirement.

CSP is **unchanged**: script/style/img from self only, no inline/eval, no fonts,
`connect-src 'none'`, no forms/base/embedded documents, stream media only through
the existing media directive. Network remains denied by the session hook too.
Resource authorization does not grant permission to fetch JSON, load fonts,
run remote modules or embed documents. Future signaling/network/font/CSP changes
need their own scoped review; do not loosen CSP to work around an asset failure.

See [MAC-SMOKE.md](./MAC-SMOKE.md) for an executable no-credentials Mac check and
[VALIDATION.md](./VALIDATION.md) for evidence actually obtained in cloud.
