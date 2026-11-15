import { sanitizePhone } from './format.js';
import { historyOutcome } from './history-mapping.js';

/** Presentation state only. Call state/time, history and audio come from ports. */
export class DesktopController {
  /** @type {'dialer' | 'history' | 'settings'} */
  screen = 'dialer';
  phone = '';
  error = '';
  busy = false;
  ending = false;
  resultVisible = false;
  historyLoading = false;
  historyError = '';
  /** @type {readonly import('./contracts').HistoryItem[]} */
  history = [];
  /** @type {Set<() => void>} */
  listeners = new Set();
  /** @type {Map<string, Date>} */
  started = new Map();
  recorded = new Set();
  disposed = false;
  /** @type {'system' | 'light' | 'dark'} */
  theme = 'system';
  constructor(/** @type {import('./contracts').DesktopServices} */ services) {
    this.services = services;
    this.snapshot = services.calls.getSnapshot();
    this.unsubscribe = services.calls.subscribe(snapshot => this.onCall(snapshot));
    this.onCall(this.snapshot);
  }
  get inCall() { return ['connecting', 'ringing', 'active', 'terminating'].includes(this.snapshot.state); }
  subscribe(/** @type {() => void} */ listener) {
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  }
  notify() { if (!this.disposed) for (const listener of this.listeners) listener(); }
  onCall(/** @type {Readonly<import('./contracts').CallSnapshot>} */ snapshot) {
    this.snapshot = snapshot;
    this.resultVisible = ['ended', 'failed'].includes(snapshot.state);
    if (snapshot.callId && !this.started.has(snapshot.callId)) this.started.set(snapshot.callId, new Date());
    if (this.inCall) this.screen = 'dialer';
    if (snapshot.callId && ['ended', 'failed'].includes(snapshot.state) && !this.recorded.has(snapshot.callId)) {
      this.recorded.add(snapshot.callId);
      if (this.services.calls.mode === 'demo') {
        const outcome = historyOutcome(snapshot);
        this.services.history.recordDemo?.({ id: snapshot.callId, number: snapshot.number,
          at: this.started.get(snapshot.callId) ?? new Date(), mode: 'demo', ...outcome,
          durationMs: outcome.connectedAt === null ? 0 : snapshot.durationMs });
      }
    }
    this.notify();
  }
  edit(/** @type {string} */ raw) { this.phone = sanitizePhone(raw); this.error = ''; this.resultVisible = false; }
  navigate(/** @type {'dialer' | 'history' | 'settings'} */ screen) {
    if (this.inCall || this.busy) return;
    this.screen = screen; this.error = ''; this.notify();
    if (screen === 'history') void this.loadHistory();
  }
  async loadHistory() {
    if (this.historyLoading) return;
    this.historyLoading = true; this.historyError = ''; this.notify();
    try { this.history = await this.services.history.load(); }
    catch { this.historyError = 'Не удалось загрузить историю. Попробуйте ещё раз.'; }
    finally { this.historyLoading = false; this.notify(); }
  }
  redial(/** @type {string} */ number) {
    if (this.inCall || this.busy || !this.snapshot.canStart) return;
    this.edit(number); this.navigate('dialer');
  }
  async start() {
    if (this.busy || this.inCall || !this.snapshot.canStart || this.disposed) return;
    this.busy = true; this.error = ''; this.notify();
    try {
      const result = await this.services.calls.start(this.phone);
      if (!result.ok) this.error = result.error || 'Не удалось начать вызов.';
    } catch { this.error = 'Не удалось начать вызов. Проверьте подключение.'; }
    finally { this.busy = false; this.notify(); }
  }
  async end() {
    const callId = this.snapshot.callId;
    if (!callId || !this.inCall || this.ending || this.snapshot.state === 'terminating') return;
    this.ending = true; this.error = ''; this.notify();
    try {
      const result = await this.services.calls.endCall(callId);
      if (!result.ok) this.error = result.error || 'Не удалось завершить вызов. Повторите попытку.';
    } catch { this.error = 'Не удалось завершить вызов. Повторите попытку.'; }
    finally { this.ending = false; this.notify(); }
  }
  dispose() { this.disposed = true; this.unsubscribe(); this.listeners.clear(); }
}
