'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const invoke = channel => ipcRenderer.invoke(channel).catch(() => { throw new Error('AUDIO_PERMISSION_FAILED'); });
contextBridge.exposeInMainWorld('sashatel', Object.freeze({
  mode: 'DEMO',
  version: '0.1.0',
  audio: Object.freeze({
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
