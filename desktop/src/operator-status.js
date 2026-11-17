/** @typedef {import('./contracts').OperatorTelephonyStatus} OperatorTelephonyStatus */

/**
 * @param {() => Promise<OperatorTelephonyStatus | null>} read
 * @param {(status: OperatorTelephonyStatus | null) => void} publish
 */
export function watchOperatorStatus(read, publish) {
  let disposed = false;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let nextPoll;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let expiration;

  async function refresh() {
    const status = await read().catch(() => null);
    if (disposed) return;
    clearTimeout(expiration);
    const remaining = status ? status.expiresAt - Date.now() : 0;
    publish(remaining > 0 ? status : null);
    if (remaining > 0) expiration = setTimeout(() => publish(null), remaining);
    nextPoll = setTimeout(() => { void refresh(); }, 3000);
  }

  void refresh();
  return () => {
    disposed = true;
    clearTimeout(nextPoll);
    clearTimeout(expiration);
  };
}
