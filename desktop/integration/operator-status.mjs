const MAX_AGE_MS = 10_000;

export function createOperatorStatusReader({ origin, token, fetchImpl = fetch, now = Date.now }) {
  let url;
  try {
    const base = new URL(origin);
    if (base.protocol === 'https:' && base.href === base.origin + '/' && !base.username && !base.password) {
      url = new URL('/v1/operator/telephony', base);
    }
  } catch { /* unconfigured */ }
  let bearer = typeof token === 'string' && /^[A-Za-z0-9._~-]{1,512}$/.test(token) ? token : null;
  let lastObserved = -1;
  let pending;

  async function read() {
    if (!url || !bearer) return null;
    try {
      const response = await fetchImpl(url, {
        method: 'GET', redirect: 'error', cache: 'no-store',
        headers: { authorization: `Bearer ${bearer}`, accept: 'application/json' },
        signal: AbortSignal.timeout(2500),
      });
      if (response.status !== 200) {
        if (response.status === 401) bearer = null;
        await response.body?.cancel();
        return null;
      }
      const { telephony_available: available, caller_id: callerId, can_call: canCall,
        observed_at_ms: observedAt } = await response.json();
      const age = now() - observedAt;
      if (!Number.isSafeInteger(observedAt) || observedAt <= lastObserved || age < 0 || age >= MAX_AGE_MS ||
          typeof available !== 'boolean' || typeof canCall !== 'boolean' ||
          (callerId !== null && (typeof callerId !== 'string' || !/^\+[1-9]\d{1,14}$/.test(callerId))) ||
          (canCall && (!available || callerId === null))) return null;
      lastObserved = observedAt;
      return { available, callerId: available ? callerId : null, canCall, expiresAt: observedAt + MAX_AGE_MS };
    } catch {
      return null;
    }
  }

  return () => {
    pending ??= read().finally(() => { pending = undefined; });
    return pending;
  };
}

export function installOperatorStatusIPC(ipcMain, policy, read) {
  ipcMain.handle('operator:telephony-status', async (event, ...args) => {
    if (!policy.validIPC(event, args) || event.senderFrame?.detached) return null;
    const result = await read();
    return policy.validIPC(event, args) && !event.senderFrame?.detached ? result : null;
  });
}
