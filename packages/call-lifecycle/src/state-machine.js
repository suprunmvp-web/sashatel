/** All legal edges. Missing edges (including duplicates) are rejected, not thrown. */
export const TRANSITIONS = Object.freeze(Object.fromEntries(Object.entries({
  idle: { start: 'connecting' },
  connecting: {
    ringing: 'ringing', connected: 'active', cancel: 'terminating',
    rejected: 'terminating', 'no-answer': 'terminating', 'setup-timeout': 'terminating',
    'remote-ended': 'terminating', 'transport-error': 'terminating', 'connection-lost': 'terminating',
  },
  ringing: {
    connected: 'active', cancel: 'terminating', rejected: 'terminating',
    'no-answer': 'terminating', 'ring-timeout': 'terminating', 'remote-ended': 'terminating',
    'transport-error': 'terminating', 'connection-lost': 'terminating',
  },
  active: {
    hangup: 'terminating', 'remote-ended': 'terminating',
    'transport-error': 'terminating', 'connection-lost': 'terminating',
  },
  terminating: {
    'cleanup-ended': 'ended', 'cleanup-failed': 'failed',
    'termination-timeout': 'failed', 'termination-error': 'failed',
  },
  ended: { start: 'connecting', reset: 'idle' },
  failed: { start: 'connecting', reset: 'idle' },
}).map(([state, edges]) => [state, Object.freeze(edges)])));

export const CALL_STATES = Object.freeze(Object.keys(TRANSITIONS));
export const CALL_EVENTS = Object.freeze([...new Set(Object.values(TRANSITIONS).flatMap(Object.keys))]);

/** @returns {string | null} null means an illegal transition. No implicit self-loops. */
export function nextState(state, event) {
  if (!Object.hasOwn(TRANSITIONS, state)) return null;
  const edges = TRANSITIONS[state];
  return Object.hasOwn(edges, event) ? edges[event] : null;
}
