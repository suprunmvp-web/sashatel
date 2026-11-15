import test from 'node:test';
import assert from 'node:assert/strict';
import { CALL_STATES, CALL_EVENTS, TRANSITIONS, nextState } from '../src/index.js';

// Independently stated spec, deliberately not generated from the implementation table.
const spec = {
  idle: { connecting: ['start'] },
  connecting: {
    ringing: ['ringing'], active: ['connected'],
    terminating: ['cancel', 'rejected', 'no-answer', 'setup-timeout', 'remote-ended', 'transport-error', 'connection-lost'],
  },
  ringing: {
    active: ['connected'],
    terminating: ['cancel', 'rejected', 'no-answer', 'ring-timeout', 'remote-ended', 'transport-error', 'connection-lost'],
  },
  active: { terminating: ['hangup', 'remote-ended', 'transport-error', 'connection-lost'] },
  terminating: { ended: ['cleanup-ended'], failed: ['cleanup-failed', 'termination-timeout', 'termination-error'] },
  ended: { connecting: ['start'], idle: ['reset'] },
  failed: { connecting: ['start'], idle: ['reset'] },
};

for (const state of CALL_STATES) {
  for (const event of [...CALL_EVENTS, 'unknown', '__proto__', 'constructor', 'toString']) {
    const expected = Object.entries(spec[state]).find(([, events]) => events.includes(event))?.[0] ?? null;
    test(`${state} + ${event}: ${expected ?? 'forbidden'}`, () => {
      assert.equal(nextState(state, event), expected);
    });
  }
}

test('unknown states and immutable formal specification', () => {
  for (const state of ['unknown', '__proto__', 'constructor', '', null]) {
    assert.equal(nextState(state, 'start'), null);
  }
  assert.deepEqual(CALL_STATES, Object.keys(spec));
  assert.throws(() => { TRANSITIONS.idle.start = 'active'; }, TypeError);
  assert.throws(() => { CALL_EVENTS.push('x'); }, TypeError);
});
