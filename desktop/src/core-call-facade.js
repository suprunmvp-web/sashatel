const errors = {
  INVALID_NUMBER: 'Введите 10 цифр или номер с кодом +7 / 8.',
  BUSY: 'Вызов уже выполняется.', CLEANUP_UNCONFIRMED: 'Очистка вызова не подтверждена. Новый вызов заблокирован.',
  TRANSPORT_UNAVAILABLE: 'SIP не подключён. Доступен только отдельный Demo/Test режим.',
};
/** Asynchronous Electron port over the existing single DesktopCallOwner. */
export class CoreCallFacade {
  /** @type {import('./contracts').Mode} */
  mode;
  /** @type {import('../../packages/call-lifecycle/src/index').OwnerSnapshot | null} */
  wire = null;
  /** @type {Set<(snapshot: Readonly<import('./contracts').CallSnapshot>) => void>} */
  listeners = new Set();
  disposed = false;
  online = false;
  pending = false;
  /** @param {import('./contracts').ElectronCallAPI} bridge */
  constructor(bridge, demo = false) {
    this.bridge = bridge; this.mode = demo ? 'demo' : 'live';
    this.unsubscribe = bridge.subscribe(snapshot => this.accept(snapshot));
  }
  accept(/** @type {import('../../packages/call-lifecycle/src/index').OwnerSnapshot} */ snapshot) {
    if (this.disposed || snapshot.protocolVersion !== 1) return;
    // No old epoch/revision may roll the view back. Epoch changes require a handshake.
    if (this.wire && (snapshot.ownerId !== this.wire.ownerId || snapshot.revision < this.wire.revision)) return;
    this.wire = snapshot; this.online = true;
    for (const listener of this.listeners) listener(this.getSnapshot());
  }
  async refresh() {
    if (this.pending || this.disposed) return;
    this.pending = true;
    try {
      const result = await this.bridge.getSnapshot();
      if (result.ok) this.accept(result.snapshot);
      else this.offline();
    } catch { this.offline(); }
    finally { this.pending = false; }
  }
  offline() { this.online = false; for (const listener of this.listeners) listener(this.getSnapshot()); }
  /** @returns {Readonly<import('./contracts').CallSnapshot>} */
  getSnapshot() {
    const c = this.wire?.call;
    return { connection: 'unavailable', state: c?.state ?? 'idle', callId: c?.callId ?? null,
      audioIssue: this.wire?.audioIssue?.code ?? null,
      number: c?.number ?? '', reason: c?.reason ?? null, durationMs: c?.durationMs ?? 0,
      connectedAt: c?.connectedAt ?? null, canStart: this.mode === 'demo' && this.online && (c?.canStart ?? false) };
  }
  subscribe(/** @type {(snapshot: Readonly<import('./contracts').CallSnapshot>) => void} */ listener) {
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  }
  async command(/** @type {{ type: 'start'; number: string } | { type: 'end'; callId: string }} */ action) {
    if (!this.online || !this.wire) return { ok: false, error: 'Владелец вызова недоступен. Дождитесь восстановления связи.' };
    try {
      const result = await this.bridge.request({ protocolVersion: 1, ownerId: this.wire.ownerId, requestId: crypto.randomUUID(), ...action });
      if (!result.ok) {
        // Renewal only reads current state. An uncertain start is never replayed.
        if (['SESSION_EXHAUSTED', 'SESSION_CLOSED'].includes(result.error.code)) await this.refresh();
        return { ok: false, error: errors[/** @type {keyof typeof errors} */ (result.error.code)] || 'Команда отклонена. Обновите состояние и повторите действие.' };
      }
      await this.refresh(); return { ok: true };
    } catch { this.offline(); return { ok: false, error: 'Связь с владельцем вызова потеряна. Состояние вызова не подтверждено.' }; }
  }
  start(/** @type {string} */ number) { return this.command({ type: 'start', number }); }
  endCall(/** @type {string} */ callId) { return this.command({ type: 'end', callId }); }
  dispose() { this.disposed = true; this.unsubscribe(); this.listeners.clear(); }
}
