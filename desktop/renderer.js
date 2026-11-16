import './audio/bootstrap.mjs';
import { DesktopController } from './src/controller.js';
import { CoreCallFacade } from './src/core-call-facade.js';
import { DemoHistory } from './src/demo-history.js';
import { UnavailableAudio } from './src/unavailable-audio.js';
import { AudioServiceFacade } from './src/audio-facade.js';
import { mountDesktop } from './src/view.js';

// Single composition root. No backend credentials or arbitrary IPC exposed to UI.
const bridge = window.sashatel?.calls;
if (!bridge) throw new Error('Electron Call bridge is required');
const calls = new CoreCallFacade(bridge, window.sashatel?.mode === 'DEMO');
await calls.refresh();
// Poll authoritative duration; elapsed wall time in the UI never confirms an answer.
const poll = window.setInterval(() => { void calls.refresh(); }, 250);
const audio = window.sashatelAudio ? new AudioServiceFacade(window.sashatelAudio) : new UnavailableAudio();
const services = { calls, audio, history: new DemoHistory(), ...(window.sashatel?.demo ? { demo: { send: /** @param {import('./src/contracts').DemoEvent} event */ event => {
  const callId = calls.getSnapshot().callId;
  if (callId) void window.sashatel?.demo?.send({ callId, event });
} } } : {}) };
const controller = new DesktopController(services);
const root = document.getElementById('app');
if (!root) throw new Error('Missing app root');
const unmount = mountDesktop(root, controller);
window.addEventListener('pagehide', () => { window.clearInterval(poll); unmount(); controller.dispose(); calls.dispose(); }, { once: true });
