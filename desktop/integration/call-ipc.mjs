// Host-only routing. A port is bound to the authenticated main-frame object and
// revoked before navigation/reload. No renderer-supplied session IDs are trusted.
export function installCallIPC({ ipcMain, owner, policy, getWindow, transport }) {
  let session;
  function revoke() { session?.port.disconnect(); session = undefined; }
  function authorized(event) {
    return policy.validIPC(event, []) && event.senderFrame && !event.senderFrame.detached;
  }
  function attach(event) {
    if (!session || session.frame !== event.senderFrame) {
      revoke();
      const port = owner.attachRenderer();
      session = { frame: event.senderFrame, port, exhausted: false };
      const current = session;
      port.subscribe(snapshot => {
        if (session === current && authorized(event)) current.frame.send('call:snapshot', snapshot);
      });
    }
    return session;
  }
  ipcMain.handle('call:snapshot', (event, ...args) => {
    if (!authorized(event) || args.length) throw new Error('INVALID_CALL_REQUEST');
    if (session?.exhausted) revoke(); // explicit fresh read after exhaustion, never replay a start
    return attach(event).port.getSnapshot();
  });
  ipcMain.handle('call:request', (event, ...args) => {
    if (!authorized(event) || args.length !== 1) throw new Error('INVALID_CALL_REQUEST');
    if (!transport) return { ok: false, error: { domain: 'owner', code: 'TRANSPORT_UNAVAILABLE' } };
    const current = attach(event);
    const result = current.port.request(args[0]); // Core performs strict wire validation
    if (!result.ok && result.error.code === 'SESSION_EXHAUSTED') current.exhausted = true;
    return result;
  });
  if (transport) ipcMain.handle('call:test-event', (event, ...args) => {
    if (!authorized(event) || args.length !== 1) throw new Error('INVALID_TEST_REQUEST');
    const value = args[0];
    if (!value || typeof value !== 'object' || Object.keys(value).sort().join() !== 'callId,event' ||
        typeof value.callId !== 'string' || value.callId !== owner.getSnapshot().call.callId) return false;
    return transport.send(value.callId, value.event);
  });
  // Diagnostics are advisory only. This channel cannot change call state or release a lease.
  ipcMain.handle('audio:issue', (event, ...args) => {
    if (!authorized(event) || args.length !== 1) throw new Error('INVALID_AUDIO_REQUEST');
    const value = args[0];
    if (!value || typeof value !== 'object' || Object.keys(value).sort().join() !== 'callId,code') return false;
    return owner.reportAudioIssue(value);
  });
  return {
    bind(win) {
      win.webContents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => { if (isMainFrame) revoke(); });
      win.webContents.on('render-process-gone', revoke);
      win.on('closed', () => { if (!getWindow() || getWindow() === win) revoke(); });
    },
    dispose() { revoke(); for (const name of ['call:snapshot', 'call:request', 'call:test-event', 'audio:issue']) ipcMain.removeHandler(name); }
  };
}
