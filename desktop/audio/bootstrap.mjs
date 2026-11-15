import { AudioDeviceService } from './audio-device-service.mjs';

// One renderer owner; no permission prompt or capture at startup.
const audio = new AudioDeviceService();
Object.defineProperty(window, 'sashatelAudio', { value: audio, writable: false });
const cleanup = () => audio.dispose();
window.addEventListener('pagehide', cleanup, { once: true });
// Do not dispose on beforeunload: Electron can cancel the navigation afterwards.
// Screens call stopTests() on unmount. Hiding/minimizing also stops diagnostics.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') audio.stopTests();
});
void audio.refreshDevices().catch(() => {}); // structured error is available via subscribe/getState
