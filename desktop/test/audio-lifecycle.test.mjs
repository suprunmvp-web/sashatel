import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, deferred, stream, tick } from './fakes.mjs';

const rejects = (promise, code) => assert.rejects(promise, { code });
const stopped = s => s.getTracks().every(t => t.readyState === 'ended');

test('media lease closure survives discovery and identifies only the affected lease', async () => {
  const f = fixture();
  try {
    const first = await f.service.acquireInput();
    const active = f.service.getState().capture;
    assert.equal(active.status, 'active'); assert.equal(active.owner, 'transport');
    f.raw[0].getTracks()[0].unplug();
    const closed = await first.closed;
    assert.deepEqual(closed, { leaseId: active.leaseId, reason: 'DEVICE_LOST' });
    assert.ok(stopped(first.stream));
    await tick();
    assert.equal(f.service.getState().error.code, 'DEVICE_LOST');
    assert.equal(f.service.getState().capture.status, 'interrupted');
    const next = await f.service.acquireInput();
    assert.notEqual(f.service.getState().capture.leaseId, closed.leaseId);
    first.release();
    assert.ok(!stopped(next.stream));
    next.release();
    assert.equal((await next.closed).reason, 'released');
    assert.equal(await first.closed, closed, 'closure resolves once and remains stable');
  } finally { f.service.dispose(); }
});

for (const events of [
  ['locked', 'suspend', 'resume', 'unlocked'],
  ['suspend', 'locked', 'unlocked', 'resume']
]) {
  test(`overlapping sleep/lock require both recovery events: ${events.join(', ')}`, async () => {
    const f = fixture();
    try {
      const lease = await f.service.acquireInput();
      for (const event of events.slice(0, 3)) f.lifecycle(event);
      assert.equal((await lease.closed).reason, 'suspended');
      assert.equal(f.service.getState().suspended, true);
      assert.throws(() => f.service.resume(), { code: 'SUSPENDED' });
      await rejects(f.service.acquireInput(), 'SUSPENDED');
      f.lifecycle(events[3]); await tick();
      assert.equal(f.service.getState().suspended, false);
      assert.equal(f.raw.length, 1, 'no automatic capture after wake');
      const next = await f.service.acquireInput(); next.release();
    } finally { f.service.dispose(); }
  });
}

test('TCC revocation closes an active media lease without waiting for track-ended', async () => {
  const f = fixture();
  try {
    const lease = await f.service.acquireInput();
    f.bridge.getMicrophonePermission = async () => 'denied';
    await f.service.refreshDevices();
    assert.equal((await lease.closed).reason, 'PERMISSION_DENIED');
    assert.ok(stopped(lease.stream));
    assert.equal(f.service.getState().capture.status, 'interrupted');
    assert.equal(f.service.getState().permission, 'denied');
    assert.equal(f.raw.length, 1);
  } finally { f.service.dispose(); }
});

test('Bluetooth-like track-ended during input replacement disposes the late replacement', async () => {
  const f = fixture(); const pending = deferred(); const late = stream();
  try {
    await f.service.selectInput('mic-a');
    const lease = await f.service.acquireInput();
    f.media.getUserMedia = () => pending.promise;
    const switching = f.service.selectInput('mic-b'); await tick();
    f.raw[0].getTracks()[0].unplug();
    assert.equal((await lease.closed).reason, 'DEVICE_LOST');
    pending.resolve(late);
    await rejects(switching, 'CANCELLED');
    assert.ok(stopped(late));
    assert.equal(f.service.getState().inputId, 'mic-a');
    assert.equal(f.service.getState().capture.status, 'interrupted');
  } finally { f.service.dispose(); }
});

test('input track ending while AudioContext resumes cannot produce a live lease', async () => {
  const f = fixture(); const pending = deferred(); const create = f.service.createContext;
  try {
    f.service.createContext = () => {
      const context = create(); context.resume = () => pending.promise;
      context.state = 'running'; return context;
    };
    const acquiring = f.service.acquireInput(); await tick();
    f.raw[0].getTracks()[0].unplug(); pending.resolve();
    await rejects(acquiring, 'DEVICE_LOST');
    assert.ok(f.contexts.every(context => context.state === 'closed'));
    assert.ok(f.raw.every(stopped));
  } finally { f.service.dispose(); }
});

test('late rejection of cancelled native capture does not poison a new operation', async () => {
  const f = fixture(); const pending = deferred(); const original = f.media.getUserMedia;
  try {
    f.media.getUserMedia = () => pending.promise;
    const old = f.service.testMicrophone(); await tick();
    assert.equal(f.service.getState().operation, 'test-input');
    f.service.stopTests(); await rejects(old, 'CANCELLED');
    f.media.getUserMedia = original;
    const lease = await f.service.acquireInput();
    pending.reject(Object.assign(Error('private hardware detail'), { name: 'NotReadableError' }));
    await tick();
    assert.equal(f.service.getState().error, null);
    assert.equal(f.service.getState().operation, null);
    assert.ok(!stopped(lease.stream)); lease.release();
  } finally { f.service.dispose(); }
});

test('timeouts during context setup close partial graph and permit an independent retry', async () => {
  const f = fixture({ timeoutMs: 20 }); const create = f.service.createContext;
  try {
    f.service.createContext = () => { const context = create(); context.resume = () => new Promise(() => {}); return context; };
    await rejects(f.service.acquireInput(), 'TIMEOUT');
    assert.ok(f.raw.every(stopped)); assert.ok(f.contexts.every(context => context.state === 'closed'));
    f.service.createContext = create;
    const lease = await f.service.acquireInput(); lease.release();
  } finally { f.service.dispose(); }
});

test('repeated transport capture and input replacement leave no streams, contexts or listeners', async () => {
  const f = fixture();
  try {
    for (let i = 0; i < 25; i++) {
      const lease = await f.service.acquireInput();
      await f.service.selectInput(i % 2 ? 'mic-a' : 'mic-b');
      lease.release(); await lease.closed;
      assert.ok(f.raw.every(stopped));
      assert.ok(f.contexts.every(context => context.state === 'closed' && context.listenerCount === 0));
      assert.ok(f.raw.flatMap(s => s.getTracks()).every(t => t.listenerCount === 0));
      assert.ok(f.contexts.flatMap(c => c.nodes).every(n => !n.connections.length));
    }
  } finally { f.service.dispose(); }
  assert.equal(f.media.listenerCount, 0);
});

test('dispose terminates the media lease with a distinct reason and never reopens it', async () => {
  const f = fixture(); const lease = await f.service.acquireInput();
  f.service.dispose();
  assert.equal((await lease.closed).reason, 'disposed');
  assert.equal(f.service.getState().disposed, true);
  assert.equal(f.service.getState().capture.status, 'idle');
  assert.equal(f.raw.length, 1);
  f.lifecycle('resume'); await tick();
  await rejects(f.service.acquireInput(), 'DISPOSED');
});

test('synchronous screen exit from test-start subscription does not leave timers/meters behind', async () => {
  const f = fixture({ amplitude: 0.1 });
  try {
    const off = f.service.subscribe(state => { if (state.testing) f.service.stopTests(); });
    await rejects(f.service.testMicrophone({ durationMs: 220 }), 'CANCELLED');
    const mic = f.service.getState().lastTest;
    assert.equal(mic.reason, 'cancelled');
    assert.equal(mic.frames, 0);
    await rejects(f.service.testPlayback({ durationMs: 220 }), 'CANCELLED');
    const output = f.service.getState().lastTest;
    assert.equal(output.reason, 'cancelled');
    await new Promise(resolve => setTimeout(resolve, 260));
    assert.equal(f.service.getState().meter, null);
    assert.equal(f.service.getState().lastTest.reason, 'cancelled');
    assert.ok(f.raw.every(stopped));
    assert.ok(f.contexts.every(c => c.state === 'closed'));
    off();
  } finally { f.service.dispose(); }
});

test('async subscriber rejections are isolated without interrupting media ownership', async () => {
  const f = fixture();
  try {
    f.service.subscribe(async () => { throw Error('broken asynchronous UI subscriber'); });
    const lease = await f.service.acquireInput(); lease.release();
    await lease.closed; await tick();
    assert.ok(f.raw.every(stopped));
    assert.equal(f.service.getState().capture.reason, 'released');
  } finally { f.service.dispose(); }
});
