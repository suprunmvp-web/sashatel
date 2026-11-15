/**
 * Classify a terminal UI snapshot without inventing a confirmed conversation.
 * @param {Readonly<import('./contracts').CallSnapshot>} snapshot
 * @returns {import('./contracts').HistoryOutcome}
 */
export function historyOutcome(snapshot) {
  const connectedAt = typeof snapshot.connectedAt === 'number' && Number.isFinite(snapshot.connectedAt) && snapshot.connectedAt >= 0
    ? snapshot.connectedAt : null;
  if (snapshot.state === 'failed') return { status: 'failed', connectedAt };
  if (connectedAt !== null) return { status: 'answered', connectedAt };
  if (['cancelled', 'local-hangup'].includes(snapshot.reason ?? '')) return { status: 'cancelled', connectedAt: null };
  if (['no-answer', 'remote-hangup', 'remote-ended'].includes(snapshot.reason ?? '')) return { status: 'missed', connectedAt: null };
  return { status: 'unknown', connectedAt: null };
}
