import test from 'node:test';
import assert from 'node:assert/strict';
import { CallLifecycle as PublicCore, parseTransportEvent } from '../src/index.js';
import { fixture, NUMBER, deferred, flush, ControlledTransport, runIsolated } from './helpers.js';

async function atState(state, options) {
  const f = await fixture(options);
  const result = f.core.start(NUMBER);
  assert.equal(result.ok, true);
  await flush();
  if (state === 'ringing') f.transport.emit('ringing');
  if (state === 'active') f.transport.emit('connected');
  return { ...f, id: result.callId };
}

test('idle snapshot, invalid input and mandatory transport; no origination by default', async () => {
  const { core, transport } = await fixture();
  assert.deepEqual(core.getSnapshot(), {
    state: 'idle', callId: null, number: null, startedAt: null, connectedAt: null,
    stoppedAt: null, endedAt: null, reason: null, durationMs: 0, canStart: true, disposed: false,
  });
  assert.equal(core.reset(), false);
  assert.equal(core.endCall('missing'), false);
  for (const number of ['', 'word', '+7999', '😀', '8'.repeat(500)]) {
    assert.equal(core.start(number).error, 'invalid-number');
  }
  assert.equal(transport.starts.length, 0);
  assert.throws(() => new PublicCore(), TypeError);
  assert.throws(() => new PublicCore({ start() {} }), TypeError);
  assert.throws(() => core.subscribe(null), TypeError);
  assert.throws(() => { core.getSnapshot().state = 'active'; }, TypeError);
});

test('confirmed connection only, duplicates cannot reset duration; timers are fully removed', async () => {
  const { core, transport, clock, id } = await atState('connecting');
  assert.equal(core.getSnapshot().state, 'connecting'); // start resolution is NOT an answer
  clock.advance(500);
  assert.equal(core.getSnapshot().durationMs, 0);
  assert.equal(transport.emit('ringing'), true);
  clock.advance(1000);
  assert.equal(core.getSnapshot().durationMs, 0);
  assert.equal(transport.emit('connected'), true);
  assert.equal(clock.pending.size, 0);
  clock.advance(1234);
  assert.equal(transport.emit('connected'), false);
  assert.equal(transport.emit('ringing'), false);
  assert.equal(core.getSnapshot().durationMs, 1234);
  assert.equal(core.endCall(id), true);
  assert.equal(core.getSnapshot().state, 'terminating');
  assert.equal(transport.starts[0].signal.aborted, true);
  clock.advance(333);
  await flush();
  assert.equal(core.getSnapshot().state, 'ended');
  assert.equal(core.getSnapshot().reason, 'local-hangup');
  assert.equal(core.getSnapshot().durationMs, 1234);
  assert.equal(core.getSnapshot().canStart, true);
  assert.equal(clock.pending.size, 0);
  assert.equal(core.reset(), true);
  assert.equal(core.getSnapshot().callId, null);
});

test('zero timestamp is a valid connection, and elapsed duration is frozen on stop', async () => {
  const { core, clock, id } = await atState('active');
  assert.equal(core.getSnapshot().connectedAt, 0);
  clock.advance(2000);
  assert.equal(core.getSnapshot().durationMs, 2000);
  core.endCall(id);
  await flush();
  clock.advance(10_000);
  assert.equal(core.getSnapshot().durationMs, 2000);
});

for (const state of ['connecting', 'ringing', 'active']) {
  for (const event of ['remote-ended', 'transport-error', 'connection-lost', 'rejected', 'no-answer']) {
    test(`transport ${event} during ${state}`, async () => {
      const { core, transport, clock, id } = await atState(state);
      const allowed = state !== 'active' || !['rejected', 'no-answer'].includes(event);
      assert.equal(transport.emit(event), allowed);
      if (!allowed) {
        assert.equal(core.getSnapshot().state, state);
        core.endCall(id);
      } else {
        assert.equal(core.getSnapshot().state, 'terminating');
        assert.equal(core.start(NUMBER).error, 'busy');
      }
      await flush();
      const reason = event === 'remote-ended' ? (state === 'active' ? 'remote-hangup' : 'no-answer') : event;
      if (allowed) {
        assert.equal(core.getSnapshot().reason, reason);
        assert.equal(core.getSnapshot().state, reason === 'remote-hangup' ? 'ended' : 'failed');
      }
      assert.equal(transport.stops.length, 1);
      assert.equal(clock.pending.size, 0);
      assert.equal(core.getSnapshot().canStart, true);
      assert.equal(transport.emit('connected'), false);
      assert.equal(transport.emit(event), false);
    });
  }
}

for (const phase of ['connecting', 'ringing']) {
  test(`cancel before connection in ${phase}; double end and late answer are inert`, async () => {
    const { core, transport, clock, id } = await atState(phase);
    assert.equal(core.endCall(id), true);
    assert.equal(core.endCall(id), false);
    assert.equal(transport.emit('connected'), false);
    assert.equal(transport.emit('remote-ended'), false);
    await flush();
    assert.equal(core.getSnapshot().state, 'ended');
    assert.equal(core.getSnapshot().reason, 'cancelled');
    assert.equal(core.getSnapshot().durationMs, 0);
    assert.equal(core.endCall(id), false);
    assert.equal(transport.stops.length, 1);
    assert.equal(clock.pending.size, 0);
  });

  test(`${phase} timeout aborts setup, runs one cleanup and produces a controlled failure`, async () => {
    const { core, transport, clock } = await atState(phase, { connectTimeoutMs: 100, ringTimeoutMs: 200 });
    clock.advance(phase === 'connecting' ? 100 : 200);
    assert.equal(core.getSnapshot().state, 'terminating');
    assert.equal(transport.emit('connected'), false);
    assert.equal(transport.starts[0].signal.aborted, true);
    await flush();
    assert.equal(core.getSnapshot().state, 'failed');
    assert.equal(core.getSnapshot().reason, phase === 'connecting' ? 'setup-timeout' : 'ring-timeout');
    assert.equal(core.getSnapshot().durationMs, 0);
    assert.equal(clock.pending.size, 0);
  });
}

test('repeated ringing does not postpone the no-answer deadline', async () => {
  const { core, transport, clock } = await atState('ringing', { ringTimeoutMs: 100 });
  clock.advance(99);
  assert.equal(transport.emit('ringing'), false);
  clock.advance(1);
  await flush();
  assert.equal(core.getSnapshot().reason, 'ring-timeout');
});

test('double click / Enter and multiple owners share a synchronous reservation', async () => {
  const { core, transport, CallLifecycle, clock } = await fixture();
  const otherTransport = new ControlledTransport();
  const other = new CallLifecycle(otherTransport, { clock });
  const first = core.start(NUMBER);
  assert.equal(first.ok, true);
  assert.equal(core.start(NUMBER).error, 'busy');
  assert.equal(other.start(NUMBER).error, 'busy');
  assert.equal(other.getSnapshot().canStart, false);
  await flush();
  assert.equal(transport.starts.length, 1);
  assert.equal(otherTransport.starts.length, 0);
  core.endCall(first.callId);
  await flush();
  const next = other.start(NUMBER);
  assert.equal(next.ok, true);
  assert.notEqual(next.callId, first.callId);
  other.endCall(next.callId);
  await flush();
});

test('same-tick cancellation/disposal prevents start and still cleans up idempotently', async () => {
  for (const dispose of [false, true]) {
    const { core, transport, clock } = await fixture();
    const { callId } = core.start(NUMBER);
    if (dispose) { core.dispose(); core.dispose(); }
    else core.endCall(callId);
    await flush();
    assert.equal(transport.starts.length, 0);
    assert.equal(transport.stops.length, 1);
    assert.equal(clock.pending.size, 0);
    assert.equal(core.getSnapshot().reason, dispose ? 'disposed' : 'cancelled');
  }
});

for (const asyncThrow of [false, true]) {
  test(`start ${asyncThrow ? 'rejection' : 'throw'} is sanitized, controlled and cleaned up`, async () => {
    const { core, transport, clock } = await fixture();
    const secret = new Error('private transport payload');
    transport.startImpl = () => {
      if (asyncThrow) return Promise.reject(secret);
      throw secret;
    };
    core.start(NUMBER);
    await flush();
    assert.equal(core.getSnapshot().state, 'failed');
    assert.equal(core.getSnapshot().reason, 'transport-error');
    assert.equal(JSON.stringify(core.getSnapshot()).includes(secret.message), false);
    assert.equal(transport.stops.length, 1);
    assert.equal(clock.pending.size, 0);
  });
}

test('pending start is aborted; its late rejection cannot corrupt the next call', async () => {
  const { core, transport } = await fixture();
  const pending = deferred();
  transport.startImpl = () => pending.promise;
  const first = core.start(NUMBER);
  await flush();
  core.endCall(first.callId);
  await flush();
  transport.startImpl = () => undefined;
  const second = core.start(NUMBER);
  await flush();
  pending.reject(new Error('late'));
  await flush();
  assert.equal(core.getSnapshot().callId, second.callId);
  assert.equal(core.getSnapshot().state, 'connecting');
  assert.equal(transport.emit('connected', 0), false);
  assert.equal(core.endCall(first.callId), false);
  core.endCall(second.callId);
  await flush();
});

test('cleanup timeout quarantines all owners; only actual late cleanup releases the lease', async () => {
  const { core, transport, clock, CallLifecycle, id } = await atState('active', { terminationTimeoutMs: 50 });
  const cleanup = deferred();
  transport.terminateImpl = () => cleanup.promise;
  core.endCall(id);
  await flush();
  clock.advance(50);
  const terminal = core.getSnapshot();
  assert.equal(terminal.state, 'failed');
  assert.equal(terminal.reason, 'termination-timeout');
  assert.equal(terminal.canStart, false);
  assert.equal(transport.stops[0].signal.aborted, true);
  assert.equal(core.reset(), false);
  assert.equal(core.start(NUMBER).error, 'busy');
  const other = new CallLifecycle(new ControlledTransport(), { clock });
  assert.equal(other.start(NUMBER).error, 'busy');
  cleanup.resolve();
  await flush();
  assert.deepEqual(core.getSnapshot(), { ...terminal, canStart: true });
  assert.equal(clock.pending.size, 0);
  assert.equal(core.reset(), true);
});

for (const asyncThrow of [false, true]) {
  test(`cleanup ${asyncThrow ? 'rejection' : 'throw'} fails closed even after dispose`, () => runIsolated(async asyncThrow => {
    const { core, transport, clock, CallLifecycle } = await fixture();
    const { callId: id } = core.start(NUMBER);
    await flush();
    transport.terminateImpl = () => {
      if (asyncThrow) return Promise.reject(new Error('cleanup'));
      throw new Error('cleanup');
    };
    core.endCall(id);
    await flush();
    assert.equal(core.getSnapshot().reason, 'termination-error');
    assert.equal(core.getSnapshot().canStart, false);
    core.dispose();
    assert.equal(core.start(NUMBER).error, 'disposed');
    assert.equal(new CallLifecycle(transport, { clock }).start(NUMBER).error, 'busy');
    assert.equal(clock.pending.size, 0);
    assert.equal(transport.stops.length, 1);
  }, asyncThrow));
}

test('timeout followed by cleanup rejection keeps the first terminal result', () => runIsolated(async () => {
  const { core, transport, clock } = await fixture({ terminationTimeoutMs: 10 });
  const { callId: id } = core.start(NUMBER);
  await flush();
  let reject;
  const cleanup = { promise: new Promise((_, no) => { reject = no; }), reject: error => reject(error) };
  transport.terminateImpl = () => cleanup.promise;
  core.endCall(id);
  await flush();
  clock.advance(10);
  const result = core.getSnapshot();
  cleanup.reject(new Error('late rejection'));
  await flush();
  assert.deepEqual(core.getSnapshot(), result);
}));

test('canceled timer callbacks cannot fail another phase or a later call', async () => {
  const { core, transport, clock, id } = await atState('connecting');
  const setupTimer = clock.callbacks.get(0);
  transport.emit('ringing');
  const ringTimer = clock.callbacks.get(1);
  transport.emit('connected');
  setupTimer(); ringTimer();
  assert.equal(core.getSnapshot().state, 'active');
  core.endCall(id);
  const cleanupTimer = clock.callbacks.get(2);
  await flush();
  const next = core.start(NUMBER);
  await flush();
  setupTimer(); ringTimer(); cleanupTimer();
  assert.equal(core.getSnapshot().state, 'connecting');
  core.endCall(next.callId);
  await flush();
});

test('untrusted / unknown SIP events and forged call IDs are safely ignored', async () => {
  const { core, transport, id } = await atState('connecting');
  const baseline = core.getSnapshot();
  for (const raw of [null, undefined, 42, 'connected', {}, [], { callId: id, type: 'SIP/2.0 183' },
    { callId: id, type: '__proto__' }, { callId: id, type: 'constructor' },
    { callId: id, type: 'connected', get ignored() { throw Error('ignored'); } },
    { get callId() { throw Error('malformed'); } }, { callId: id, get type() { throw Error('bad'); } }]) {
    // Additional unused fields are never read; a valid normalized event is accepted.
    if (raw && Object.hasOwn(raw, 'ignored')) continue;
    assert.equal(transport.starts[0].emit(raw), false);
  }
  assert.equal(transport.emit('connected', 0, { callId: 'another-attempt' }), false);
  assert.deepEqual(core.getSnapshot(), baseline);
  assert.equal(parseTransportEvent({ type: 'connected', callId: 5 }), null);
  assert.equal(parseTransportEvent({ callId: id, type: 'connected', get ignored() { throw Error(); } }).type, 'connected');
  core.endCall(id);
  await flush();
});

test('synchronous events inside transport methods and abort handlers preserve ordering', async () => {
  const { core, transport } = await fixture();
  const seen = [];
  core.subscribe(s => seen.push(s.state));
  transport.startImpl = request => {
    request.signal.addEventListener('abort', () => request.emit({ callId: request.callId, type: 'connected' }));
    request.emit({ callId: request.callId, type: 'connected' });
    core.endCall(request.callId);
  };
  transport.terminateImpl = request => transport.emit('remote-ended', 0, { callId: request.callId });
  core.start(NUMBER);
  await flush();
  assert.deepEqual(seen, ['connecting', 'active', 'terminating', 'ended']);
  assert.equal(core.getSnapshot().reason, 'local-hangup');
});

test('observer exceptions, unsubscribe and reentrant cancel cannot break effects or ordering', async () => {
  const { core, transport } = await fixture();
  const seen = [];
  core.subscribe(() => { throw Error('view error'); });
  const unsubscribe = core.subscribe(snapshot => {
    seen.push(snapshot.state);
    if (snapshot.state === 'connecting') core.endCall(snapshot.callId);
  });
  const other = [];
  core.subscribe(snapshot => other.push(snapshot.state));
  core.start(NUMBER);
  await flush();
  assert.deepEqual(seen, ['connecting', 'terminating', 'ended']);
  assert.deepEqual(other, seen);
  assert.equal(transport.starts.length, 0);
  unsubscribe();
  core.reset();
  assert.equal(seen.length, 3);
  core.dispose();
  core.dispose();
  assert.equal(core.getSnapshot().disposed, true);
  assert.equal(core.reset(), false);
  core.subscribe(() => assert.fail('disposed observer'))();
});

for (const phase of ['active', 'ringing', 'terminating', 'failed', 'ended']) {
  test(`disposal during ${phase} cancels operations and never permits another start`, async () => {
    const { core, transport, clock, id } = await atState(phase === 'active' ? 'active' : 'ringing');
    if (['terminating', 'failed', 'ended'].includes(phase)) {
      if (phase === 'failed') transport.emit('transport-error');
      else core.endCall(id);
      if (phase !== 'terminating') await flush();
    }
    core.dispose();
    core.dispose();
    await flush();
    assert.equal(core.start(NUMBER).error, 'disposed');
    assert.equal(transport.stops.length, 1);
    assert.equal(clock.pending.size, 0);
  });
}

test('constructor and policy extension validation; default platform clock works', async () => {
  const transport = new ControlledTransport();
  for (const ms of [0, -1, NaN, Infinity, 0.5, 2 ** 31]) {
    for (const key of ['connectTimeoutMs', 'ringTimeoutMs', 'terminationTimeoutMs']) {
      assert.throws(() => new PublicCore(transport, { [key]: ms }), RangeError);
    }
  }
  assert.throws(() => new PublicCore(transport, { clock: {} }), TypeError);
  assert.throws(() => new PublicCore(transport, { normalizeNumber: false }), TypeError);
  const core = new PublicCore(transport);
  const { callId } = core.start(NUMBER);
  await flush();
  transport.emit('connected');
  assert.ok(core.getSnapshot().durationMs >= 0);
  core.endCall(callId);
  await flush();
  assert.equal(core.getSnapshot().canStart, true);
  const f = await fixture({ normalizeNumber: () => ({ ok: true, number: '+442079460000' }) });
  const foreign = f.core.start('UK policy input');
  assert.equal(f.core.getSnapshot().number, '+442079460000');
  f.core.endCall(foreign.callId);
  await flush();
  for (const policy of [() => { throw Error(); }, () => undefined, () => ({ ok: true, number: 'oops' })]) {
    const invalid = await fixture({ normalizeNumber: policy });
    assert.equal(invalid.core.start(NUMBER).error, 'invalid-number');
  }
});

test('policy reentrancy cannot bypass acquisition or disposal', async () => {
  let nested = false, inner;
  const f = await fixture({ normalizeNumber: () => {
    if (!nested) { nested = true; inner = f.core.start(NUMBER); }
    return { ok: true, number: '+79991234567' };
  } });
  assert.equal(f.core.start(NUMBER).error, 'busy');
  assert.equal(inner.ok, true);
  f.core.endCall(inner.callId);
  await flush();
  const g = await fixture({ normalizeNumber: () => {
    g.core.dispose();
    return { ok: true, number: '+79991234567' };
  } });
  assert.equal(g.core.start(NUMBER).error, 'disposed');
});

test('policy result getters are read once and getter failures become validation errors', async () => {
  const throwing = await fixture({ normalizeNumber: () => ({
    ok: true, get number() { throw Error('policy boundary failure'); },
  }) });
  assert.equal(throwing.core.start(NUMBER).error, 'invalid-number');
  let reads = 0;
  const changing = await fixture({ normalizeNumber: () => ({
    ok: true, get number() { return ++reads <= 2 ? '+79991234567' : 'unsafe-unvalidated-value'; },
  }) });
  const result = changing.core.start(NUMBER);
  assert.equal(result.ok, true);
  assert.equal(changing.core.getSnapshot().number, '+79991234567');
  assert.equal(reads, 1);
  changing.core.endCall(result.callId);
  await flush();
});
