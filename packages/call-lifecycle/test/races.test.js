import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, NUMBER, deferred, flush, random } from './helpers.js';

function* permutations(values) {
  if (!values.length) { yield []; return; }
  for (let i = 0; i < values.length; i++) {
    for (const tail of permutations(values.filter((_, index) => index !== i))) yield [values[i], ...tail];
  }
}

test('all 120 event/command permutations agree with an independent first-outcome model', async () => {
  const { core, transport, clock } = await fixture();
  for (const ordering of permutations(['ringing', 'connected', 'remote-ended', 'connection-lost', 'end'])) {
    const cleanup = deferred();
    transport.terminateImpl = () => cleanup.promise;
    const { callId } = core.start(NUMBER);
    await flush();
    let phase = 'connecting', outcome = null;
    const beforeStops = transport.stops.length;
    for (const event of ordering) {
      if (phase !== 'terminating') {
        if (event === 'ringing' && phase === 'connecting') phase = 'ringing';
        if (event === 'connected') phase = 'active';
        if (['remote-ended', 'connection-lost', 'end'].includes(event)) {
          outcome = event === 'connection-lost' ? 'connection-lost'
            : event === 'remote-ended' ? (phase === 'active' ? 'remote-hangup' : 'no-answer')
              : phase === 'active' ? 'local-hangup' : 'cancelled';
          phase = 'terminating';
        }
      }
      if (event === 'end') core.endCall(callId);
      else transport.emit(event);
      await flush();
      assert.equal(core.getSnapshot().state, phase, ordering.join(', '));
      assert.equal(core.getSnapshot().reason, outcome);
    }
    assert.equal(transport.stops.length, beforeStops + 1);
    cleanup.resolve();
    await flush();
    assert.equal(core.getSnapshot().state, ['connection-lost', 'no-answer'].includes(outcome) ? 'failed' : 'ended');
    assert.equal(core.getSnapshot().reason, outcome);
    assert.equal(clock.pending.size, 0);
  }
});

test('seeded stress properties: 10,000 adversarial steps, rapid reuse, deferred setup/cleanup', async () => {
  for (const seed of [1, 42, 0x5a5a, 0xdeadbeef]) {
    const rng = random(seed);
    const { core, transport, clock } = await fixture({
      connectTimeoutMs: 7, ringTimeoutMs: 11, terminationTimeoutMs: 5,
    });
    const starts = new Map(), cleanups = new Map(), live = new Set();
    const connected = new Map(), terminal = new Map(), seenIds = new Set();
    transport.startImpl = request => {
      assert.equal(live.size, 0, `overlapping session, seed ${seed}`);
      live.add(request.callId);
      const pending = deferred();
      starts.set(request.callId, pending);
      return pending.promise;
    };
    transport.terminateImpl = request => {
      assert.equal(cleanups.has(request.callId), false, 'duplicate teardown');
      const pending = deferred();
      cleanups.set(request.callId, pending);
      return pending.promise.then(() => live.delete(request.callId));
    };
    const events = ['ringing', 'connected', 'remote-ended', 'rejected', 'no-answer',
      'connection-lost', 'transport-error', '183', '__proto__'];
    for (let step = 0; step < 2500; step++) {
      const before = core.getSnapshot();
      switch (Math.floor(rng() * 10)) {
        case 0: {
          const result = core.start(NUMBER);
          if (result.ok) {
            assert.equal(seenIds.has(result.callId), false);
            seenIds.add(result.callId);
          }
          break;
        }
        case 1: core.endCall(before.callId); core.endCall(before.callId); break;
        case 2: core.endCall('stale-command'); break;
        case 3: case 4: {
          if (transport.starts.length) {
            // Deliberately pick OLD attempts, not only the current session.
            const index = Math.floor(rng() * transport.starts.length);
            transport.emit(events[Math.floor(rng() * events.length)], index);
          }
          break;
        }
        case 5: clock.advance(Math.floor(rng() * 20)); break;
        case 6: {
          const pending = [...cleanups.values()].filter(p => !p.settled);
          const chosen = pending[Math.floor(rng() * pending.length)];
          if (chosen) { chosen.settled = true; chosen.resolve(); }
          break;
        }
        case 7: {
          const pending = [...starts.values()].filter(p => !p.settled);
          const chosen = pending[Math.floor(rng() * pending.length)];
          if (chosen) {
            chosen.settled = true;
            if (rng() < 0.5) chosen.resolve();
            else chosen.reject(Error('generated network failure'));
          }
          break;
        }
        case 8: core.reset(); break;
        case 9: assert.equal(core.start('😀').ok, false); break;
      }
      await flush();
      const snapshot = core.getSnapshot();
      const context = `seed=${seed}, step=${step}, state=${snapshot.state}`;
      assert.ok(live.size <= 1, context);
      assert.ok(snapshot.durationMs >= 0, context);
      if (snapshot.connectedAt === null) assert.equal(snapshot.durationMs, 0, context);
      else {
        if (connected.has(snapshot.callId)) assert.equal(snapshot.connectedAt, connected.get(snapshot.callId), context);
        connected.set(snapshot.callId, snapshot.connectedAt);
      }
      if (['ended', 'failed'].includes(snapshot.state)) {
        const result = { reason: snapshot.reason, duration: snapshot.durationMs, endedAt: snapshot.endedAt };
        if (terminal.has(snapshot.callId)) assert.deepEqual(result, terminal.get(snapshot.callId), context);
        terminal.set(snapshot.callId, result);
      }
      if (snapshot.canStart) {
        assert.equal(live.size, 0, context);
        assert.ok(['idle', 'ended', 'failed'].includes(snapshot.state), context);
      }
      assert.ok(clock.pending.size <= 1, context);
    }
    const current = core.getSnapshot();
    core.endCall(current.callId);
    await flush();
    for (const pending of cleanups.values()) pending.resolve();
    for (const pending of starts.values()) pending.resolve();
    await flush();
    assert.equal(core.getSnapshot().canStart, true);
    assert.equal(clock.pending.size, 0);
    assert.ok(seenIds.size > 20, `insufficient reuse, seed ${seed}`);
    core.dispose();
  }
});
