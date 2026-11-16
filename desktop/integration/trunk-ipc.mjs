const publicErrors = new Set([
  'BACKEND_UNCONFIGURED', 'INVALID_SESSION', 'ACCESS_DENIED', 'TRUNK_OR_ROUTE_NOT_FOUND',
  'INVALID_TRUNK', 'TRUNK_CONFLICT', 'RATE_LIMITED', 'BACKEND_UNREACHABLE', 'INVALID_RESPONSE',
]);

export function installTrunkIPC(ipcMain, policy, api) {
  function handle(operation, arity) {
    ipcMain.handle(`trunk:${operation}`, async (event, ...args) => {
      if (args.length !== arity || !policy.validIPC(event, [])) return { ok: false, code: 'ACCESS_DENIED' };
      try { return { ok: true, value: await api[operation](...args) }; }
      catch (error) {
        return { ok: false, code: publicErrors.has(error?.message) ? error.message : 'BACKEND_UNREACHABLE' };
      }
    });
  }
  handle('list', 0);
  handle('create', 1);
  handle('remove', 1);
}
