import { nextState } from './state-machine.js';
import { normalizeRussianNumber } from './phone-number.js';
import { parseTransportEvent } from './transport.js';

// Shared by all owners importing this module in ONE JS realm. Never unlock on a
// deadline alone: a timed-out adapter might still hold a live SIP session.
let lease = null;
let sequence = 0n;
const realmId = globalThis.crypto.randomUUID();
const LIVE = new Set(['connecting', 'ringing', 'active']);
const NORMAL = new Set(['cancelled', 'local-hangup', 'remote-hangup', 'disposed']);
const defaultClock = Object.freeze({
  now: () => performance.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: id => globalThis.clearTimeout(id),
});

/** UI-free, single-owner outbound lifecycle. No transport is supplied by default. */
export class CallLifecycle {
  #transport;
  #clock;
  #normalize;
  #timeouts;
  #state = 'idle';
  #call = null;
  #disposed = false;
  #listeners = new Set();
  #notifications = [];
  #notifying = false;

  /**
   * @param {import('./transport.js').CallTransport} transport
   * @param {Object} [options]
   * @param {{now: () => number, setTimeout: Function, clearTimeout: Function}} [options.clock]
   * Trusted monotonic clock/scheduler; injectable for deterministic tests.
   * @param {number} [options.connectTimeoutMs]
   * @param {number} [options.ringTimeoutMs]
   * @param {number} [options.terminationTimeoutMs]
   * @param {typeof normalizeRussianNumber} [options.normalizeNumber]
   * Trusted policy extension point for international numbering.
   */
  constructor(transport, options = {}) {
    if (typeof transport?.start !== 'function' || typeof transport?.terminate !== 'function') {
      throw new TypeError('A CallTransport with start and terminate is required');
    }
    this.#transport = {
      start: transport.start.bind(transport), terminate: transport.terminate.bind(transport),
    };
    this.#clock = options.clock ?? defaultClock;
    for (const method of ['now', 'setTimeout', 'clearTimeout']) {
      if (typeof this.#clock[method] !== 'function') throw new TypeError(`Invalid clock.${method}`);
    }
    this.#normalize = options.normalizeNumber ?? normalizeRussianNumber;
    if (typeof this.#normalize !== 'function') throw new TypeError('Invalid number policy');
    this.#timeouts = {
      connecting: options.connectTimeoutMs ?? 15_000,
      ringing: options.ringTimeoutMs ?? 45_000,
      terminating: options.terminationTimeoutMs ?? 5_000,
    };
    for (const ms of Object.values(this.#timeouts)) {
      if (!Number.isInteger(ms) || ms <= 0 || ms > 2_147_483_647) {
        throw new RangeError('Timeouts must be positive 32-bit millisecond integers');
      }
    }
  }

  /** Frozen value, no mutable references. Duration uses a monotonic clock, not wall time. */
  getSnapshot() {
    const call = this.#call;
    const durationMs = call?.connectedAt == null ? 0 : Math.max(0,
      (call.stoppedAt ?? this.#clock.now()) - call.connectedAt);
    return Object.freeze({
      state: this.#state, callId: call?.id ?? null, number: call?.number ?? null,
      startedAt: call?.startedAt ?? null, connectedAt: call?.connectedAt ?? null,
      stoppedAt: call?.stoppedAt ?? null, endedAt: call?.endedAt ?? null,
      reason: call?.reason ?? null, durationMs,
      canStart: !this.#disposed && lease === null,
      disposed: this.#disposed,
    });
  }

  /** Notifications are ordered, isolated from observer exceptions and reentrant-safe. */
  subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('Listener must be a function');
    if (!this.#disposed) this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Synchronous reservation prevents double clicks before any asynchronous work. */
  start(rawNumber) {
    if (this.#disposed) return { ok: false, error: 'disposed' };
    if (lease !== null) return { ok: false, error: 'busy' };
    let ok, number, detail;
    try {
      const normalized = this.#normalize(rawNumber);
      // Snapshot policy output once: getters must not swap a validated destination
      // before transport submission, throw out of start, or bypass the lease check.
      ok = normalized?.ok;
      number = normalized?.number;
      detail = normalized?.error;
    } catch { ok = false; }
    if (ok !== true || typeof number !== 'string' || !/^\+[1-9]\d{1,14}$/.test(number)) {
      return { ok: false, error: 'invalid-number', detail: typeof detail === 'string' ? detail : 'invalid-policy-result' };
    }
    // A custom policy may reenter start. Check the lease AGAIN before acquiring it.
    if (this.#disposed) return { ok: false, error: 'disposed' };
    if (lease !== null) return { ok: false, error: 'busy' };
    const call = {
      id: `${realmId}:${++sequence}`, number,
      startedAt: this.#clock.now(), connectedAt: null, stoppedAt: null, endedAt: null,
      reason: null, failed: false, safe: false, timer: null,
      setup: new AbortController(), cleanup: new AbortController(),
    };
    lease = call;
    this.#call = call;
    this.#move('start');
    this.#arm(call, 'setup-timeout');
    // Deliberately defer transport work until reservation and publication finish.
    // Cancellation in a subscriber or the same tick prevents origination entirely.
    Promise.resolve().then(() => {
      if (call.setup.signal.aborted) return;
      return this.#transport.start(Object.freeze({
        callId: call.id, number: call.number, signal: call.setup.signal,
        emit: event => this.#receive(call, event),
      }));
    }).catch(() => this.#receive(call, { callId: call.id, type: 'transport-error' }));
    this.#publish();
    return { ok: true, callId: call.id };
  }

  /** callId is mandatory: a stale button/IPC command must not end a newer call. */
  endCall(callId) {
    const call = this.#call;
    if (!call || call.id !== callId || !LIVE.has(this.#state)) return false;
    const active = this.#state === 'active';
    this.#terminate(call, active ? 'hangup' : 'cancel', active ? 'local-hangup' : 'cancelled');
    return true;
  }

  reset() {
    if (this.#disposed || !this.#call?.safe || !this.#move('reset')) return false;
    this.#call = null;
    this.#publish();
    return true;
  }

  /** Idempotent shutdown. Does not force-release an uncertain transport lease. */
  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    if (LIVE.has(this.#state)) {
      this.#terminate(this.#call, this.#state === 'active' ? 'hangup' : 'cancel', 'disposed');
    } else {
      this.#publish();
    }
    this.#listeners.clear();
  }

  #move(event) {
    const state = nextState(this.#state, event);
    if (state === null) return false;
    this.#state = state;
    return true;
  }

  #receive(call, raw) {
    const event = parseTransportEvent(raw);
    if (!event || call !== this.#call || event.callId !== call.id ||
        nextState(this.#state, event.type) === null) return false;
    if (event.type === 'ringing' || event.type === 'connected') {
      this.#clearTimer(call);
      this.#move(event.type);
      if (event.type === 'ringing') this.#arm(call, 'ring-timeout');
      else call.connectedAt = this.#clock.now();
      this.#publish();
    } else {
      const reason = event.type === 'remote-ended'
        ? (this.#state === 'active' ? 'remote-hangup' : 'no-answer') : event.type;
      this.#terminate(call, event.type, reason);
    }
    return true;
  }

  #terminate(call, event, reason) {
    if (!this.#move(event)) return;
    call.reason = reason;
    call.failed = !NORMAL.has(reason);
    call.stoppedAt = this.#clock.now();
    this.#clearTimer(call);
    this.#arm(call, 'termination-timeout');
    // Change state BEFORE abort: abort handlers may emit synchronously.
    call.setup.abort();
    Promise.resolve().then(() => this.#transport.terminate(Object.freeze({
      callId: call.id, reason, signal: call.cleanup.signal,
    }))).then(() => this.#cleaned(call), () => this.#cleanupFailed(call, 'termination-error'));
    this.#publish();
  }

  #cleaned(call) {
    call.safe = true;
    if (lease === call) lease = null;
    this.#clearTimer(call);
    if (this.#state === 'terminating') {
      this.#move(call.failed ? 'cleanup-failed' : 'cleanup-ended');
      call.endedAt = this.#clock.now();
    }
    // A late success releases quarantine but never rewrites an already terminal result.
    this.#publish();
  }

  #cleanupFailed(call, event) {
    if (!this.#move(event)) return;
    this.#clearTimer(call);
    call.reason = event;
    call.endedAt = this.#clock.now();
    call.cleanup.abort();
    // No lease release: neither rejection nor timeout proves the session is gone.
    this.#publish();
  }

  #arm(call, event) {
    call.timer = this.#clock.setTimeout(() => {
      if (call !== this.#call || nextState(this.#state, event) === null) return;
      if (event === 'termination-timeout') this.#cleanupFailed(call, event);
      else this.#terminate(call, event, event);
    }, this.#timeouts[this.#state]);
  }

  #clearTimer(call) {
    if (call.timer !== null) this.#clock.clearTimeout(call.timer);
    call.timer = null;
  }

  #publish() {
    this.#notifications.push(this.getSnapshot());
    if (this.#notifying) return;
    this.#notifying = true;
    try {
      while (this.#notifications.length) {
        const snapshot = this.#notifications.shift();
        for (const listener of [...this.#listeners]) {
          try { listener(snapshot); } catch { /* observers cannot break lifecycle effects */ }
        }
      }
    } finally {
      this.#notifying = false;
    }
  }
}
