'use strict';
const { app, BrowserWindow, session, ipcMain, systemPreferences, powerMonitor } = require('electron');
const path = require('node:path');
const { createPolicy } = require('./security.cjs');
const entryPath = path.join(__dirname, 'index.html');
let window = null;
let permissionRequest = null;
const policy = createPolicy(entryPath, () => window);

function permissionStatus() {
  return process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('microphone') : 'unknown';
}

function installAudioIPC() {
  const handle = (channel, handler) => ipcMain.handle(channel, async (event, ...args) => {
    if (!policy.validIPC(event, args)) throw new Error('INVALID_AUDIO_REQUEST');
    try { return await handler(); }
    catch { throw new Error('AUDIO_PERMISSION_FAILED'); }
  });
  handle('audio:microphone-status', permissionStatus);
  handle('audio:microphone-request', async () => {
    if (process.platform !== 'darwin') return true;
    const status = permissionStatus();
    if (status === 'granted') return true;
    if (status === 'denied' || status === 'restricted') return false;
    if (!permissionRequest) {
      permissionRequest = systemPreferences.askForMediaAccess('microphone').finally(() => { permissionRequest = null; });
    }
    return permissionRequest;
  });
  for (const [nativeEvent, event] of [
    ['suspend', 'suspend'], ['resume', 'resume'], ['lock-screen', 'locked'], ['unlock-screen', 'unlocked']
  ]) {
    powerMonitor.on(nativeEvent, () => {
      if (window && !window.isDestroyed() && policy.trustedURL(window.webContents.getURL())) {
        window.webContents.send('audio:lifecycle', event);
      }
    });
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 760,
    minHeight: 560,
    title: 'SashaTel',
    backgroundColor: '#f7f8fa',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });
  window = win;
  void win.loadFile(entryPath).catch(() => { if (!win.isDestroyed()) win.destroy(); });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('will-frame-navigate', event => event.preventDefault());
  win.webContents.on('will-redirect', event => event.preventDefault());
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  win.webContents.on('render-process-gone', () => { if (!win.isDestroyed()) win.destroy(); });
  win.on('closed', () => { if (window === win) window = null; });
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(policy.permissionRequest(contents, permission, details));
  });
  session.defaultSession.setPermissionCheckHandler((contents, permission, _origin, details) =>
    policy.permissionCheck(contents, permission, details));
  // Local resources only. No external documents, remote scripts or diagnostic requests.
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !policy.allowedResource(details.url) });
  });
  installAudioIPC();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch(() => { app.exit(1); });
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
