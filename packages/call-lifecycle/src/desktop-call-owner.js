import { CallLifecycle } from './call-lifecycle.js';

export const DESKTOP_PROTOCOL_VERSION = 1;
// Compatibility vocabulary only; this module neither imports nor controls Audio.
export const AUDIO_ERROR_CODES = Object.freeze([
  'PERMISSION_DENIED', 'NO_INPUT', 'NO_OUTPUT', 'DEVICE_UNAVAILABLE', 'DEVICE_LOST',
  'OUTPUT_SELECTION_UNSUPPORTED', 'UNSUPPORTED', 'AUDIO_INTERRUPTED', 'AUDIO_FAILED',
  'TIMEOUT', 'CANCELLED', 'BUSY', 'SUSPENDED', 'DISPOSED', 'INVALID_ARGUMENT',
]);

const errorDomains = Object.freeze({
  INVALID_COMMAND: 'protocol', VERSION_MISMATCH: 'protocol', REQUEST_PENDING: 'protocol', OWNER_CHANGED: 'owner',
  SESSION_CLOSED: 'owner', OWNER_CLOSED: 'owner', REQUEST_CONFLICT: 'protocol',
  SESSION_EXHAUSTED: 'owner', BUSY: 'call', CLEANUP_UNCONFIRMED: 'call',
  INVALID_NUMBER: 'call', STALE_CALL: 'call', NOT_ACTIVE: 'call',
});

function failure(code) {
  return Object.freeze({ ok: false, error: Object.freeze({ domain: errorDomains[code], code }) });
}

// Only structured-clone data enters the owner. Reading once also handles hostile
// getters in direct JS use. Strict fields prevent hidden transport/audio commands.
function commandData(raw) {
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const { protocolVersion, ownerId, requestId, type, number, callId } = raw;
    if (typeof ownerId !== 'string' || ownerId.length > 128 ||
        typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{1,96}$/.test(requestId)) return null;
    const field = type === 'start' ? 'number' : type === 'end' ? 'callId' : null;
    if (field === null || Object.keys(raw).some(key =>
      !['protocolVersion', 'ownerId', 'requestId', 'type', field].includes(key))) return null;
    if (type === 'start' && (typeof number !== 'string' || number.length > 128)) return null;
    if (type === 'end' && (typeof callId !== 'string' || callId.length === 0 || callId.length > 256)) return null;
    return { protocolVersion, ownerId, requestId, type, value: type === 'start' ? number : callId };
  } catch { return null; }
}

/**
 * In-process authority boundary, NOT an Electron IPC/security implementation.
 * The host constructs exactly one owner in its long-lived call/media process.
 * attachRenderer and reportAudioIssue are HOST-only, never exposed over renderer IPC.
 */
export class DesktopCallOwner {
  #core;
  #ownerId = globalThis.crypto.randomUUID();
  #revision = 0;
  #closed = false;
  #sessions = new Set();
  #maxRequests;
  #audioIssue = null;
  #unsubscribe;
  #notifications = [];
  #publishing = false;

  constructor(transport, { maxRequestsPerSession = 256, ...coreOptions } = {}) {
    if (!Number.isInteger(maxRequestsPerSession) || maxRequestsPerSession < 1 || maxRequestsPerSession > 4096) {
      throw new RangeError('Session request limit must be 1..4096');
    }
    this.#maxRequests = maxRequestsPerSession;
    this.#core = new CallLifecycle(transport, coreOptions);
    this.#unsubscribe = this.#core.subscribe(() => this.#publish());
  }

  getSnapshot() {
    const call = this.#core.getSnapshot();
    const safety = this.#closed ? 'closed' : call.canStart ? 'ready'
      : call.state === 'failed' ? 'cleanup-unconfirmed' : 'occupied';
    return Object.freeze({
      protocolVersion: DESKTOP_PROTOCOL_VERSION, ownerId: this.#ownerId,
      revision: this.#revision, safety, call,
      audioIssue: this.#audioIssue?.callId === call.callId ? this.#audioIssue : null,
    });
  }

  /** Host obtains a port only after authenticating a frame and its incarnation. */
  attachRenderer() {
    if (this.#closed) throw new Error('Call owner is closed');
    const session = { active: true, requests: new Map(), listeners: new Map() };
    this.#sessions.add(session);
    const disconnect = () => {
      session.active = false;
      session.listeners.clear();
      session.requests.clear();
      this.#sessions.delete(session);
      // Renderer loss NEVER means SIP cleanup or permission to release a lease.
    };
    return Object.freeze({
      getSnapshot: () => {
        if (this.#closed) return failure('OWNER_CLOSED');
        if (!session.active) return failure('SESSION_CLOSED');
        return Object.freeze({ ok: true, snapshot: this.getSnapshot() });
      },
      request: command => this.#request(session, command),
      subscribe: listener => {
        if (typeof listener !== 'function') throw new TypeError('Listener must be a function');
        if (!session.active || this.#closed) return () => {};
        const snapshot = this.getSnapshot();
        session.listeners.set(listener, snapshot.revision);
        try { listener(snapshot); } catch { /* view failure is isolated */ }
        return () => session.listeners.delete(listener);
      },
      disconnect,
    });
  }

  /** Advisory, already sanitized Audio service code, correlated by captured call ID. */
  reportAudioIssue(value) {
    let callId, code;
    try { ({ callId, code } = value); } catch { return false; }
    const call = this.#core.getSnapshot();
    if (this.#closed || callId !== call.callId || !AUDIO_ERROR_CODES.includes(code) ||
        !['connecting', 'ringing', 'active', 'terminating'].includes(call.state)) return false;
    this.#audioIssue = Object.freeze({ domain: 'audio', callId, code });
    this.#publish();
    return true;
  }

  /** Host shutdown only. No force-unlock, retry or renderer-owned teardown. */
  dispose() {
    if (this.#closed) return;
    this.#closed = true;
    this.#core.dispose();
    this.#unsubscribe();
    for (const session of this.#sessions) {
      session.active = false;
      session.listeners.clear();
      session.requests.clear();
    }
    this.#sessions.clear();
  }

  #request(session, raw) {
    if (this.#closed) return failure('OWNER_CLOSED');
    if (!session.active) return failure('SESSION_CLOSED');
    const command = commandData(raw);
    if (!command) return failure('INVALID_COMMAND');
    if (command.protocolVersion !== DESKTOP_PROTOCOL_VERSION) return failure('VERSION_MISMATCH');
    if (command.ownerId !== this.#ownerId) return failure('OWNER_CHANGED');
    const fingerprint = JSON.stringify([command.type, command.value]);
    const previous = session.requests.get(command.requestId);
    if (previous) return previous.fingerprint === fingerprint ? previous.result : failure('REQUEST_CONFLICT');
    if (session.requests.size >= this.#maxRequests) return failure('SESSION_EXHAUSTED');

    // Reserve BEFORE calling core: core subscriptions can synchronously reenter.
    // A retransmission while handling the original cannot start a second call.
    const entry = { fingerprint, result: failure('REQUEST_PENDING') };
    session.requests.set(command.requestId, entry);
    const snapshot = this.#core.getSnapshot();
    if (command.type === 'start') {
      const result = this.#core.start(command.value);
      entry.result = result.ok ? Object.freeze({ ok: true, callId: result.callId })
        : failure(result.error === 'disposed' ? 'OWNER_CLOSED' : result.error === 'invalid-number' ? 'INVALID_NUMBER'
          : snapshot.state === 'failed' && !snapshot.canStart ? 'CLEANUP_UNCONFIRMED' : 'BUSY');
    } else {
      entry.result = command.value !== snapshot.callId ? failure('STALE_CALL')
        : this.#core.endCall(command.value) ? Object.freeze({ ok: true, callId: command.value }) : failure('NOT_ACTIVE');
    }
    return entry.result;
  }

  #publish() {
    this.#revision++;
    this.#notifications.push(this.getSnapshot());
    if (this.#publishing) return;
    this.#publishing = true;
    try {
      while (this.#notifications.length) {
        const snapshot = this.#notifications.shift();
        for (const session of [...this.#sessions]) {
          for (const [listener] of [...session.listeners]) {
            const last = session.listeners.get(listener);
            if (!session.active || last === undefined || last >= snapshot.revision) continue;
            session.listeners.set(listener, snapshot.revision);
            try { listener(snapshot); } catch { /* no observer may break call effects */ }
          }
        }
      }
    } finally {
      this.#publishing = false;
    }
  }
}
