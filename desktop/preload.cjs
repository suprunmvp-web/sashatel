'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const invoke = channel => ipcRenderer.invoke(channel).catch(() => { throw new Error('AUDIO_PERMISSION_FAILED'); });
contextBridge.exposeInMainWorld('sashatel', Object.freeze({
  mode: process.argv.includes('--sashatel-demo') ? 'DEMO' : 'UNAVAILABLE',
  calls: Object.freeze({
    getSnapshot: () => ipcRenderer.invoke('call:snapshot'),
    request: command => ipcRenderer.invoke('call:request', command),
    subscribe: listener => {
      if (typeof listener !== 'function') throw new TypeError('INVALID_LISTENER');
      const handler = (_event, value) => { try { listener(value); } catch { /* isolated observer */ } };
      ipcRenderer.on('call:snapshot', handler);
      return () => ipcRenderer.removeListener('call:snapshot', handler);
    }
  }),
  ...(process.argv.includes('--sashatel-demo') ? { demo: Object.freeze({
    send: value => ipcRenderer.invoke('call:test-event', value)
  }) } : {}),
  version: '0.1.0',
  platform: process.platform,
  audio: Object.freeze({
    reportIssue: value => ipcRenderer.invoke('audio:issue', value),
    getMicrophonePermission: () => invoke('audio:microphone-status'),
    requestMicrophonePermission: () => invoke('audio:microphone-request'),
    onLifecycle: listener => {
      if (typeof listener !== 'function') throw new TypeError('INVALID_LISTENER');
      const handler = (_event, value) => {
        if (['suspend', 'resume', 'locked', 'unlocked'].includes(value)) {
          try { listener(value); } catch { /* renderer callback cannot break preload */ }
        }
      };
      ipcRenderer.on('audio:lifecycle', handler);
      return () => ipcRenderer.removeListener('audio:lifecycle', handler);
    }
  })
}));
