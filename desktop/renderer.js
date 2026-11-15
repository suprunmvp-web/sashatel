import { DesktopController } from './src/controller.js';
import { DemoCallAdapter } from './src/demo-adapter.js';
import { DemoHistory } from './src/demo-history.js';
import { UnavailableAudio } from './src/unavailable-audio.js';
import { AudioServiceFacade } from './src/audio-facade.js';
import { mountDesktop } from './src/view.js';

// Single composition root. No backend credentials or arbitrary IPC exposed to UI.
const calls = new DemoCallAdapter();
const audio = window.sashatelAudio ? new AudioServiceFacade(window.sashatelAudio) : new UnavailableAudio();
const services = { calls, audio, history: new DemoHistory(), demo: calls };
const controller = new DesktopController(services);
const root = document.getElementById('app');
if (!root) throw new Error('Missing app root');
const unmount = mountDesktop(root, controller);
window.addEventListener('pagehide', () => { unmount(); controller.dispose(); }, { once: true });
