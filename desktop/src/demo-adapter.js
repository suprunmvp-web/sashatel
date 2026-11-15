import { normalizePhone } from './format.js';
/** @typedef {import('./contracts').CallPort} CallPort */
/** @typedef {import('./contracts').DemoControls} DemoControls */

/**
 * Explicitly operated UI demonstration. No SIP, media, network or automatic answer.
 * Replace this composition dependency with a facade over the shared lifecycle core.
 * @implements {CallPort}
 * @implements {DemoControls}
 */
export class DemoCallAdapter {
  /** @type {'demo'} */
  mode = 'demo';
  /** @type {import('./contracts').CallSnapshot} */
  snapshot = { connection: 'unavailable', state: 'idle', callId: null, number: '', canStart: true, durationMs: 0, connectedAt: null, reason: null };
  /** @type {Set<(snapshot: Readonly<import('./contracts').CallSnapshot>) => void>} */
  listeners = new Set();
  sequence = 0;
  constructor(/** @type {() => number} */ now = () => performance.now()) { this.now = now; }
  getSnapshot() {
    return Object.freeze({ ...this.snapshot, durationMs: this.snapshot.state === 'active' && this.snapshot.connectedAt !== null
      ? Math.max(0, this.now() - this.snapshot.connectedAt) : this.snapshot.durationMs });
  }
  subscribe(/** @type {(snapshot: Readonly<import('./contracts').CallSnapshot>) => void} */ listener) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  publish() { for (const listener of this.listeners) listener(this.getSnapshot()); }
  start(/** @type {string} */ raw) {
    if (!this.snapshot.canStart) return { ok: false, error: 'Вызов уже выполняется.' };
    const number = normalizePhone(raw);
    if (!number) return { ok: false, error: 'Введите 10 цифр или номер с кодом +7 / 8.' };
    this.snapshot = { connection: 'unavailable', state: 'connecting', callId: `demo-${++this.sequence}`, number, canStart: false, durationMs: 0, connectedAt: null, reason: null };
    this.publish();
    return { ok: true };
  }
  endCall(/** @type {string} */ callId) {
    if (this.snapshot.callId !== callId || this.snapshot.canStart) return { ok: false };
    this.finish('ended', this.snapshot.connectedAt === null ? 'cancelled' : 'local-hangup');
    return { ok: true };
  }
  finish(/** @type {'ended' | 'failed'} */ state, /** @type {string} */ reason) {
    const durationMs = this.getSnapshot().durationMs;
    this.snapshot = { ...this.snapshot, state, reason, durationMs, canStart: true };
    this.publish();
  }
  send(/** @type {import('./contracts').DemoEvent} */ event) {
    const state = this.snapshot.state;
    if (!['connecting', 'ringing', 'active'].includes(state)) return;
    if (event === 'ringing' && state === 'connecting') {
      this.snapshot = { ...this.snapshot, state: 'ringing' };
    } else if (event === 'connected' && (state === 'connecting' || state === 'ringing')) {
      this.snapshot = { ...this.snapshot, state: 'active', connectedAt: this.now() };
    } else if (event === 'connection-lost' || (event === 'rejected' && state !== 'active')) {
      this.finish('failed', event); return;
    } else if (event === 'remote-ended') {
      this.finish('ended', this.snapshot.connectedAt === null ? 'no-answer' : 'remote-hangup'); return;
    } else return;
    this.publish();
  }
}
