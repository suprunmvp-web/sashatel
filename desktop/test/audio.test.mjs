import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, deferred, tick, stream } from './fakes.mjs';

const rejects = (promise, code) => assert.rejects(promise, { code });
const stopped = s => s.getTracks().every(t => t.readyState === 'ended');
function clean(f) {
  assert.ok(f.raw.every(stopped), 'raw capture tracks released');
  assert.ok(f.contexts.every(c => c.state === 'closed'), 'contexts closed');
  assert.ok(f.contexts.flatMap(c => c.nodes).every(n => !n.connections.length), 'nodes disconnected');
  assert.ok(f.elements.every(e => !e.playing && !e.srcObject), 'playback detached');
}

test('discovery does not request capture; snapshots and subscribers are isolated', async () => {
  const f = fixture();
  const off = f.service.subscribe(() => { throw Error('UI failed'); });
  await f.service.refreshDevices();
  const state = f.service.getState();
  assert.equal(state.devices.inputs.length, 2);
  state.devices.inputs.length = 0;
  assert.equal(f.service.getState().devices.inputs.length, 2);
  assert.equal(f.raw.length, 0);
  off(); f.service.dispose(); clean(f);
});

for (const permission of ['denied', 'restricted']) {
  test(`macOS ${permission} denies capture without opening a device`, async () => {
    const f = fixture({ permission });
    await rejects(f.service.requestPermission(), 'PERMISSION_DENIED');
    assert.equal(f.raw.length, 0);
    f.service.dispose(); clean(f);
  });
}

for (const [name, code] of [['NotAllowedError', 'PERMISSION_DENIED'], ['NotFoundError', 'NO_INPUT'],
  ['NotReadableError', 'DEVICE_UNAVAILABLE'], ['OverconstrainedError', 'DEVICE_UNAVAILABLE']]) {
  test(`Chromium ${name} is sanitized and retryable`, async () => {
    const f = fixture();
    const original = f.media.getUserMedia;
    f.media.getUserMedia = async () => { throw Object.assign(Error('private device serial'), { name }); };
    await rejects(f.service.acquireInput(), code);
    assert.deepEqual(f.service.getState().error, { code });
    f.media.getUserMedia = original;
    const lease = await f.service.acquireInput();
    lease.release(); lease.release();
    f.service.dispose(); clean(f);
  });
}

test('permission request stops its temporary stream and refreshes labels', async () => {
  const f = fixture();
  assert.equal(await f.service.requestPermission(), 'granted');
  assert.equal(f.contexts.length, 0);
  f.service.dispose(); clean(f);
});

test('non-live stream is rejected and released', async () => {
  const f = fixture();
  const s = stream(); s.getTracks()[0].stop();
  f.media.getUserMedia = async () => s;
  await rejects(f.service.acquireInput(), 'NO_INPUT');
  f.service.dispose(); clean(f);
});

test('no output and stale IDs fail without creating a graph', async () => {
  const f = fixture(); f.setDevices([]);
  await rejects(f.service.testPlayback(), 'NO_OUTPUT');
  await rejects(f.service.selectInput('gone'), 'NO_INPUT');
  await rejects(f.service.selectOutput('gone'), 'NO_OUTPUT');
  assert.equal(f.contexts.length, 0);
  f.service.dispose(); clean(f);
});

test('input selection uses exact constraints and replaces the source of a stable lease', async () => {
  const f = fixture();
  await f.service.selectInput('mic-a');
  const lease = await f.service.acquireInput();
  const output = lease.stream;
  assert.deepEqual(f.constraints[0], { audio: { deviceId: { exact: 'mic-a' } }, video: false });
  f.service.setInputGain(1.5);
  assert.equal(f.service.input.gain.gain.value, 1.5);
  await f.service.selectInput('mic-b');
  assert.equal(lease.stream, output);
  assert.ok(stopped(f.raw[0]));
  assert.ok(!stopped(f.raw[1]));
  assert.equal(f.service.input.nodes.length, 4);
  lease.release(); f.service.dispose(); clean(f);
});

test('failed input switch preserves the existing stream and selection', async () => {
  const f = fixture();
  await f.service.selectInput('mic-a');
  const lease = await f.service.acquireInput();
  f.media.getUserMedia = async () => { throw Object.assign(Error(), { name: 'NotReadableError' }); };
  await rejects(f.service.selectInput('mic-b'), 'DEVICE_UNAVAILABLE');
  assert.equal(f.service.getState().inputId, 'mic-a');
  assert.ok(!stopped(f.raw[0]));
  lease.release(); f.service.dispose(); clean(f);
});

test('silence is not reported as signal; repeated real-sample meter calculations release resources', async () => {
  const f = fixture();
  for (let i = 0; i < 3; i++) {
    const result = await f.service.testMicrophone({ durationMs: 220 });
    assert.ok(result.frames >= 3);
    assert.equal(result.signalDetected, false);
    assert.equal(result.maxRms, 0);
    assert.equal(result.reason, 'completed');
    clean(f);
  }
  f.service.dispose();
});

test('signal requires measured PCM frames; gain does not fabricate meter readings', async () => {
  const f = fixture({ amplitude: 0.1 });
  let meter;
  f.service.subscribe(state => { if (state.meter) meter = state.meter; });
  f.service.setInputGain(0);
  const result = await f.service.testMicrophone({ durationMs: 220 });
  assert.equal(result.signalDetected, true);
  assert.ok(Math.abs(meter.dbFS + 20) < 0.001);
  assert.ok(Math.abs(result.maxRms - 0.1) < 0.001);
  assert.ok(result.signalFrames >= 3);
  f.service.dispose(); clean(f);
});

test('simultaneous capture is rejected BUSY; cancelled late capture is stopped', async () => {
  const f = fixture(); const pending = deferred(); const late = stream();
  f.media.getUserMedia = () => pending.promise;
  const result = f.service.testMicrophone();
  await tick();
  await rejects(f.service.acquireInput(), 'BUSY');
  f.service.stopTests();
  await rejects(result, 'CANCELLED');
  pending.resolve(late); await tick();
  assert.ok(stopped(late));
  f.service.dispose(); clean(f);
});

test('hung capture times out; late result is stopped and subsequent capture works', async () => {
  const f = fixture({ timeoutMs: 20 }); const pending = deferred(); const late = stream();
  const original = f.media.getUserMedia;
  f.media.getUserMedia = () => pending.promise;
  await rejects(f.service.acquireInput(), 'TIMEOUT');
  f.media.getUserMedia = original;
  const lease = await f.service.acquireInput();
  pending.resolve(late); await tick();
  assert.ok(stopped(late)); assert.ok(!stopped(lease.stream));
  lease.release(); f.service.dispose(); clean(f);
});

test('unplug ends active capture and does not reopen on refresh', async () => {
  const f = fixture(); const lease = await f.service.acquireInput();
  f.raw[0].getTracks()[0].unplug(); await tick();
  assert.ok(stopped(lease.stream));
  assert.equal(f.raw.length, 1);
  f.service.dispose(); clean(f);
});

test('devicechange removes selected input and releases test; retry selects default', async () => {
  const f = fixture(); await f.service.selectInput('mic-a');
  const result = f.service.testMicrophone(); await tick();
  f.setDevices([]); f.media.dispatchEvent(new Event('devicechange'));
  assert.equal((await result).reason, 'DEVICE_LOST');
  assert.equal(f.service.getState().inputId, '');
  assert.deepEqual(f.service.getState().error, { code: 'DEVICE_LOST' });
  f.service.dispose(); clean(f);
});

test('devicechange during a pending operation is refreshed after it completes', async () => {
  const f = fixture(); const pending = deferred();
  const original = f.media.getUserMedia;
  f.media.getUserMedia = () => pending.promise;
  const result = f.service.acquireInput(); await tick();
  f.setDevices([]); f.media.dispatchEvent(new Event('devicechange'));
  await tick(); pending.resolve(stream()); const lease = await result; await tick();
  assert.equal(f.service.getState().devices.inputs.length, 0);
  assert.ok(stopped(lease.stream));
  f.media.getUserMedia = original;
  f.service.dispose(); clean(f);
});

test('suspend releases transport and playback; resume does not restart either', async () => {
  const f = fixture(); await f.service.acquireInput();
  const playback = f.service.testPlayback({ durationMs: 500 }); await tick();
  f.lifecycle('suspend');
  assert.equal((await playback).reason, 'suspended');
  await rejects(f.service.acquireInput(), 'SUSPENDED');
  const count = f.raw.length;
  await f.service.resume();
  assert.equal(f.raw.length, count);
  const lease = await f.service.acquireInput(); lease.release();
  f.service.dispose(); clean(f);
});

test('context interruption after switching inputs still releases the graph', async () => {
  const f = fixture(); const lease = await f.service.acquireInput();
  await f.service.selectInput('mic-b');
  f.contexts[0].state = 'suspended'; f.contexts[0].dispatchEvent(new Event('statechange'));
  assert.ok(stopped(lease.stream));
  assert.equal(f.service.getState().error.code, 'AUDIO_INTERRUPTED');
  f.service.dispose(); clean(f);
});

test('playback uses selected sink and volume; completion never asserts physical audibility', async () => {
  const f = fixture(); await f.service.selectOutput('out-b');
  const result = f.service.testPlayback({ durationMs: 220 }); await tick();
  assert.equal(f.service.output.element.sinkId, 'out-b');
  f.service.setPlaybackVolume(0.2);
  assert.equal(f.service.output.element.volume, 0.2);
  const done = await result;
  assert.equal(done.reason, 'completed');
  assert.equal(done.playbackStarted, true);
  assert.equal(done.audibilityConfirmed, false);
  f.service.dispose(); clean(f);
});

test('unsupported sink selection keeps default playback available', async () => {
  const f = fixture({ noSink: true });
  await rejects(f.service.selectOutput('out-a'), 'OUTPUT_SELECTION_UNSUPPORTED');
  const result = f.service.testPlayback({ durationMs: 220 }); await tick();
  f.service.stopTests(); assert.equal((await result).reason, 'cancelled');
  f.service.dispose(); clean(f);
});

for (const operation of ['play', 'setSinkId', 'resume']) {
  test(`rejected ${operation} releases all output resources`, async () => {
    const f = fixture();
    if (operation === 'resume') {
      const create = f.service.createContext;
      f.service.createContext = () => { const c = create(); c.resume = async () => { throw Error(); }; return c; };
    } else {
      const create = f.service.createElement;
      f.service.createElement = () => { const e = create(); e[operation] = async () => { throw Error(); }; return e; };
    }
    await rejects(f.service.testPlayback(), 'AUDIO_FAILED');
    f.service.dispose(); clean(f);
  });
}

test('managed WebRTC playback applies routing/volume but never stops borrowed remote tracks', async () => {
  const f = fixture(); const remote = stream(); const element = f.createElement();
  const detach = await f.service.attachPlayback(element, remote);
  await f.service.selectOutput('out-b');
  f.service.setPlaybackVolume(0.4);
  assert.equal(element.sinkId, 'out-b'); assert.equal(element.volume, 0.4);
  detach(); detach();
  assert.ok(!stopped(remote));
  f.service.dispose(); clean(f);
});

test('missing output stops managed playback; timed-out routing cannot restart it', async () => {
  const f = fixture({ timeoutMs: 20 }); const remote = stream(); const element = f.createElement();
  await f.service.attachPlayback(element, remote);
  element.setSinkId = () => new Promise(() => {});
  await rejects(f.service.selectOutput('out-b'), 'TIMEOUT');
  assert.equal(element.srcObject, null);
  assert.equal(element.playing, false);
  f.service.dispose(); clean(f);
});

test('invalid numbers and device IDs fail before touching hardware', () => {
  const f = fixture();
  for (const value of [NaN, Infinity, -1, 3, '1']) assert.throws(() => f.service.setInputGain(value), { code: 'INVALID_ARGUMENT' });
  for (const value of [NaN, Infinity, -1, 2, '1']) assert.throws(() => f.service.setPlaybackVolume(value), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => f.service.selectInput({}), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => f.service.testMicrophone({ durationMs: Infinity }), { code: 'INVALID_ARGUMENT' });
  f.service.dispose(); clean(f);
});

test('explicit output removal stops playback and clears selection without fallback audio', async () => {
  const f = fixture(); await f.service.selectOutput('out-a');
  const element = f.createElement(); await f.service.attachPlayback(element, stream());
  const result = f.service.testPlayback(); await tick();
  f.setDevices([]); f.media.dispatchEvent(new Event('devicechange'));
  assert.equal((await result).reason, 'DEVICE_LOST');
  assert.equal(f.service.getState().outputId, '');
  assert.equal(element.playing, false); assert.equal(element.srcObject, null);
  f.service.dispose(); clean(f);
});

test('media element error releases the test and remote playback', async () => {
  const f = fixture();
  const result = f.service.testPlayback(); await tick();
  f.service.output.element.dispatchEvent(new Event('error'));
  assert.equal((await result).reason, 'DEVICE_UNAVAILABLE');
  const element = f.createElement(); await f.service.attachPlayback(element, stream());
  element.dispatchEvent(new Event('error'));
  assert.equal(f.service.playbacks.size, 0);
  f.service.dispose(); clean(f);
});

test('revoked OS permission after resume is reflected and does not recapture', async () => {
  const f = fixture(); await f.service.acquireInput(); f.service.suspend();
  f.bridge.getMicrophonePermission = async () => 'denied';
  await f.service.resume();
  assert.equal(f.service.getState().systemPermission, 'denied');
  assert.equal(f.service.getState().permission, 'denied');
  await rejects(f.service.acquireInput(), 'PERMISSION_DENIED');
  assert.equal(f.raw.length, 1);
  f.service.dispose(); clean(f);
});

test('late permission resolution never starts capture after test cancellation', async () => {
  const f = fixture(); const pending = deferred();
  f.bridge.getMicrophonePermission = () => pending.promise;
  const result = f.service.testMicrophone(); await tick();
  f.service.stopTests(); await rejects(result, 'CANCELLED');
  pending.resolve('granted'); await tick(); assert.equal(f.raw.length, 0);
  f.service.dispose(); clean(f);
});

test('late play resolution after cancellation is paused and detached', async () => {
  const f = fixture(); const pending = deferred();
  const create = f.service.createElement;
  let element;
  f.service.createElement = () => {
    element = create(); element.play = async () => { await pending.promise; element.playing = true; }; return element;
  };
  const result = f.service.testPlayback(); await tick();
  f.service.stopTests(); await rejects(result, 'CANCELLED');
  pending.resolve(); await tick();
  assert.equal(element.playing, false); assert.equal(element.srcObject, null);
  f.service.dispose(); clean(f);
});

test('setSinkId missing device is an output error, not an input error', async () => {
  const f = fixture(); const create = f.service.createElement;
  f.service.createElement = () => {
    const e = create(); e.setSinkId = async () => { throw Object.assign(Error(), { name: 'NotFoundError' }); }; return e;
  };
  await rejects(f.service.testPlayback(), 'NO_OUTPUT');
  f.service.dispose(); clean(f);
});

test('rapid screen exits and dispose cancel pending native operations without unhandled rejection', async () => {
  const f = fixture(); const pending = deferred(); const late = stream();
  f.media.getUserMedia = () => pending.promise;
  const result = f.service.testMicrophone(); await tick();
  f.service.dispose(); f.service.dispose();
  await rejects(result, 'CANCELLED');
  pending.resolve(late); await tick(); assert.ok(stopped(late));
  await rejects(f.service.refreshDevices(), 'DISPOSED');
  f.media.dispatchEvent(new Event('devicechange')); await tick();
  clean(f);
});
