import { AudioDeviceService } from '../audio/audio-device-service.mjs';

export const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
export const tick = () => new Promise(resolve => setTimeout(resolve, 0));
export class Track extends EventTarget {
  readyState = 'live';
  stop() { this.readyState = 'ended'; }
  unplug() { this.stop(); this.dispatchEvent(new Event('ended')); }
}
export function stream() {
  const tracks = [new Track()];
  return { getTracks: () => tracks, getAudioTracks: () => tracks };
}

export function fixture(options = {}) {
  const raw = [], contexts = [], elements = [], constraints = [];
  const media = new EventTarget();
  let devices = [
    { kind: 'audioinput', deviceId: 'mic-a', label: 'Mic A' },
    { kind: 'audioinput', deviceId: 'mic-b', label: 'Mic B' },
    { kind: 'audiooutput', deviceId: 'out-a', label: 'Output A' },
    { kind: 'audiooutput', deviceId: 'out-b', label: 'Output B' }
  ];
  media.enumerateDevices = async () => devices;
  media.getUserMedia = async value => { constraints.push(value); const s = stream(); raw.push(s); return s; };
  const createContext = () => {
    const context = new EventTarget();
    context.state = 'suspended';
    context.nodes = [];
    const node = () => {
      const result = { connections: [], connect(target) { this.connections.push(target); },
        disconnect() { this.connections = []; } };
      context.nodes.push(result);
      return result;
    };
    context.createMediaStreamSource = () => node();
    context.createGain = () => Object.assign(node(), { gain: { value: 1 } });
    context.createAnalyser = () => Object.assign(node(), {
      fftSize: 2048, getFloatTimeDomainData(array) { array.fill(options.amplitude || 0); }
    });
    context.createMediaStreamDestination = () => Object.assign(node(), { stream: stream() });
    context.createOscillator = () => Object.assign(node(), { frequency: { value: 0 }, start() {}, stop() {} });
    context.resume = async () => { context.state = 'running'; };
    context.close = async () => { context.state = 'closed'; };
    contexts.push(context);
    return context;
  };
  const createElement = () => {
    const element = Object.assign(new EventTarget(), { srcObject: null, volume: 1, playing: false, sinkId: '',
      async setSinkId(id) { this.sinkId = id; },
      async play() { this.playing = true; }, pause() { this.playing = false; } });
    if (options.noSink) delete element.setSinkId;
    elements.push(element);
    return element;
  };
  let lifecycle;
  const bridge = {
    getMicrophonePermission: async () => options.permission || 'granted',
    requestMicrophonePermission: async () => true,
    onLifecycle(callback) { lifecycle = callback; return () => { lifecycle = null; }; }
  };
  const service = new AudioDeviceService({ mediaDevices: media, bridge, createContext, createElement,
    timeoutMs: options.timeoutMs || 100 });
  return { service, media, bridge, raw, contexts, elements, constraints, createElement,
    setDevices(value) { devices = value; }, lifecycle: value => lifecycle?.(value) };
}
