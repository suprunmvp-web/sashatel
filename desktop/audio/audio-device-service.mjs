import { AudioDeviceError, audioError, requireValue } from './errors.mjs';
import { discoverDevices, validateDeviceId } from './devices.mjs';
import { AudioPermissions } from './permissions.mjs';
import { bounded, releaseGraph, stopStream } from './resources.mjs';

/** Renderer-owned service. No SIP, DOM layout, storage, recording or diagnostics. */
export class AudioDeviceService {
  constructor({ mediaDevices = globalThis.navigator?.mediaDevices,
    createContext = () => new AudioContext(), createElement = () => new Audio(),
    bridge = globalThis.sashatel?.audio, timeoutMs = 12000 } = {}) {
    this.mediaDevices = mediaDevices;
    this.createContext = createContext;
    this.createElement = createElement;
    this.permissions = new AudioPermissions(bridge);
    this.timeoutMs = timeoutMs;
    this.listeners = new Set();
    this.input = null;
    this.output = null;
    this.playbacks = new Set();
    this.pending = null;
    this.disposed = false;
    this.suspended = false;
    this.lifecycleBlocks = new Set();
    this.leaseSequence = 0;
    this.state = {
      devices: { inputs: [], outputs: [] }, permission: 'unknown', systemPermission: 'unknown',
      inputId: '', outputId: '', inputGain: 1, volume: 0.7,
      testing: null, meter: null, lastTest: null, error: null,
      operation: null, suspended: false, disposed: false,
      capture: { status: 'idle', owner: null, leaseId: null, reason: null },
      capabilities: { outputSelection: typeof this.createElement().setSinkId === 'function',
        systemMicrophoneGain: false, softwareInputGain: true }
    };
    this.onDeviceChange = () => {
      void this.refreshDevices().catch(error => {
        if (error.code === 'BUSY') this.refreshAgain = true;
      });
    };
    mediaDevices?.addEventListener('devicechange', this.onDeviceChange);
    this.unsubscribeLifecycle = bridge?.onLifecycle(event => {
      if (event === 'suspend' || event === 'locked') {
        this.lifecycleBlocks.add(event === 'suspend' ? 'sleep' : 'lock');
        this.suspend();
      }
      if (event === 'resume' || event === 'unlocked') {
        this.lifecycleBlocks.delete(event === 'resume' ? 'sleep' : 'lock');
        if (!this.lifecycleBlocks.size) void this.resume().catch(() => {});
      }
    });
  }

  getState() { return structuredClone(this.state); }
  subscribe(listener) {
    requireValue(!this.disposed, 'DISPOSED');
    requireValue(typeof listener === 'function', 'INVALID_ARGUMENT');
    this.listeners.add(listener);
    this._notify(listener);
    return () => this.listeners.delete(listener);
  }
  _notify(listener) {
    try { void Promise.resolve(listener(this.getState())).catch(() => {}); }
    catch { /* isolate both synchronous and async UI subscribers */ }
  }
  _emit(patch) {
    Object.assign(this.state, patch);
    for (const listener of this.listeners) this._notify(listener);
  }
  async _run(kind, operation) {
    requireValue(!this.disposed, 'DISPOSED');
    requireValue(!this.suspended, 'SUSPENDED');
    requireValue(!this.pending, 'BUSY');
    const token = { kind, controller: new AbortController() };
    this.pending = token;
    this._emit({ operation: kind, ...(kind !== 'discover' ? { error: null } : {}) });
    try {
      const result = await operation(token.controller.signal);
      requireValue(!token.controller.signal.aborted, 'CANCELLED');
      return result;
    } catch (cause) {
      const error = audioError(cause);
      if (error.code !== 'CANCELLED') this._emit({ error: { code: error.code } });
      throw error;
    } finally {
      if (this.pending === token) { this.pending = null; this._emit({ operation: null }); }
      if (this.refreshAgain && !this.pending && !this.disposed && !this.suspended) {
        this.refreshAgain = false;
        this.onDeviceChange();
      }
    }
  }
  _wait(promise, signal, late) {
    return bounded(promise, { milliseconds: this.timeoutMs, signal, late });
  }
  _cancel(kind) {
    if (this.pending && (!kind || this.pending.kind === kind)) {
      const pending = this.pending;
      this.pending = null;
      pending.controller.abort();
      this._emit({ operation: null });
    }
  }
  async _discover(signal) {
    const systemPermission = await this._wait(this.permissions.status(), signal);
    const denied = systemPermission === 'denied' || systemPermission === 'restricted';
    if (denied) this._releaseInput('PERMISSION_DENIED');
    const devices = await this._wait(discoverDevices(this.mediaDevices), signal);
    let missing = false;
    if (this.state.inputId && !devices.inputs.some(d => d.id === this.state.inputId)) {
      this._releaseInput('DEVICE_LOST');
      this.state.inputId = '';
      missing = true;
    }
    if (this.state.outputId && !devices.outputs.some(d => d.id === this.state.outputId)) {
      this._releaseOutput('DEVICE_LOST');
      // Stop managed playback rather than silently moving private audio to speakers.
      this._detachPlaybacks();
      this.state.outputId = '';
      missing = true;
    }
    if (!devices.inputs.length && this.input) { this._releaseInput('DEVICE_LOST'); missing = true; }
    if (!devices.outputs.length) {
      if (this.output || this.playbacks.size) missing = true;
      this._releaseOutput('DEVICE_LOST');
      this._detachPlaybacks();
    }
    this._emit({ devices, systemPermission,
      ...(denied ? { permission: systemPermission, error: { code: 'PERMISSION_DENIED' } } : {}),
      ...(missing ? { error: { code: 'DEVICE_LOST' } } : {}) });
    return devices;
  }
  refreshDevices() { return this._run('discover', signal => this._discover(signal)); }
  requestPermission() {
    return this._run('permission', async signal => {
      try {
        const stream = await this._capture('', signal);
        stopStream(stream);
        this._emit({ permission: 'granted' });
        await this._discover(signal);
        return 'granted';
      } catch (error) {
        if (audioError(error).code === 'PERMISSION_DENIED') this._emit({ permission: 'denied' });
        throw error;
      }
    });
  }
  async _capture(id, signal) {
    requireValue(this.mediaDevices?.getUserMedia, 'UNSUPPORTED');
    try {
      await this._wait(this.permissions.request(), signal);
      requireValue(!signal.aborted, 'CANCELLED');
      const stream = await this._wait(this.mediaDevices.getUserMedia({
        audio: id ? { deviceId: { exact: id } } : true, video: false
      }), signal, stopStream);
      if (!stream.getAudioTracks().some(t => t.readyState === 'live')) {
        stopStream(stream);
        throw new AudioDeviceError('NO_INPUT');
      }
      this._emit({ permission: 'granted' });
      return stream;
    } catch (error) {
      if (audioError(error).code === 'PERMISSION_DENIED') this._emit({ permission: 'denied' });
      throw error;
    }
  }
  selectInput(id) {
    validateDeviceId(id);
    return this._run('select-input', async signal => {
      if (id) requireValue((await this._discover(signal)).inputs.some(d => d.id === id), 'NO_INPUT');
      if (this.input && id !== this.state.inputId) {
        const graph = this.input;
        const raw = await this._capture(id, signal);
        try {
          requireValue(this.input === graph && !graph.released, 'CANCELLED');
          const source = graph.context.createMediaStreamSource(raw);
          source.connect(graph.analyser);
          graph.unwatchTracks?.();
          graph.source.disconnect();
          graph.nodes = graph.nodes.filter(node => node !== graph.source);
          stopStream(graph.raw);
          graph.raw = raw;
          graph.source = source;
          graph.nodes.push(source);
          this._watchInput(graph);
        } catch (error) { stopStream(raw); throw error; }
      }
      this._emit({ inputId: id });
    });
  }
  _watchInput(graph) {
    const ended = () => {
      if (this.input === graph) {
        this._releaseInput('DEVICE_LOST');
        this._emit({ error: { code: 'DEVICE_LOST' } });
        this.onDeviceChange();
      }
    };
    const tracks = graph.raw.getAudioTracks();
    tracks.forEach(track => track.addEventListener('ended', ended));
    graph.unwatchTracks = () => tracks.forEach(track => track.removeEventListener('ended', ended));
  }
  async _acquireInput(signal, owner) {
    requireValue(!this.input, 'BUSY');
    const graph = { nodes: [], owner };
    try {
      graph.raw = await this._capture(this.state.inputId, signal);
      graph.context = this.createContext();
      graph.source = graph.context.createMediaStreamSource(graph.raw);
      graph.analyser = graph.context.createAnalyser();
      graph.analyser.fftSize = 2048;
      graph.gain = graph.context.createGain();
      graph.gain.gain.value = this.state.inputGain;
      graph.destination = graph.context.createMediaStreamDestination();
      graph.stream = graph.destination.stream;
      graph.nodes = [graph.source, graph.analyser, graph.gain, graph.destination];
      graph.source.connect(graph.analyser);
      graph.analyser.connect(graph.gain);
      graph.gain.connect(graph.destination);
      await this._wait(graph.context.resume(), signal);
      requireValue(graph.context.state === 'running', 'AUDIO_INTERRUPTED');
      requireValue(graph.raw.getAudioTracks().some(track => track.readyState === 'live'), 'DEVICE_LOST');
      graph.leaseId = ++this.leaseSequence;
      graph.closed = new Promise(resolve => { graph.resolveClosed = resolve; });
      this.input = graph;
      this._watchInput(graph);
      this._watchContext(graph, () => this._releaseInput('AUDIO_INTERRUPTED'));
      this._emit({ capture: { status: 'active', owner, leaseId: graph.leaseId, reason: null } });
      requireValue(this.input === graph && !signal.aborted, 'CANCELLED');
      return graph;
    } catch (error) { releaseGraph(graph); throw error; }
  }
  _watchContext(graph, release) {
    const changed = () => {
      if (!graph.released && graph.context.state !== 'running') {
        release();
        this._emit({ error: { code: 'AUDIO_INTERRUPTED' } });
      }
    };
    graph.context.addEventListener('statechange', changed);
    graph.unwatch = () => graph.context.removeEventListener('statechange', changed);
  }
  acquireInput() {
    return this._run('capture', async signal => {
      const graph = await this._acquireInput(signal, 'transport');
      return Object.freeze({
        stream: graph.stream,
        // Media lifetime only. This is never evidence that SIP signaling ended.
        closed: graph.closed,
        release: () => { if (this.input === graph) this._releaseInput('released'); }
      });
    });
  }
  setInputGain(value) {
    requireValue(!this.disposed, 'DISPOSED');
    requireValue(Number.isFinite(value) && value >= 0 && value <= 2, 'INVALID_ARGUMENT');
    if (this.input) this.input.gain.gain.value = value;
    this._emit({ inputGain: value });
  }
  setPlaybackVolume(value) {
    requireValue(!this.disposed, 'DISPOSED');
    requireValue(Number.isFinite(value) && value >= 0 && value <= 1, 'INVALID_ARGUMENT');
    if (this.output?.element) this.output.element.volume = value;
    for (const playback of this.playbacks) playback.element.volume = value;
    this._emit({ volume: value });
  }
  async _route(element, id, signal) {
    if (typeof element.setSinkId !== 'function') {
      requireValue(!id, 'OUTPUT_SELECTION_UNSUPPORTED');
      return;
    }
    try { await this._wait(element.setSinkId(id), signal); }
    catch (error) {
      if (error?.name === 'NotFoundError') throw new AudioDeviceError('NO_OUTPUT');
      throw error;
    }
  }
  _watchPlayback(element, failed) {
    const onError = () => {
      failed();
      this._emit({ error: { code: 'DEVICE_UNAVAILABLE' } });
    };
    element.addEventListener('error', onError);
    return () => element.removeEventListener('error', onError);
  }
  _detachPlayback(playback) {
    playback.unwatch?.();
    playback.element.pause();
    playback.element.srcObject = null;
    this.playbacks.delete(playback);
  }
  selectOutput(id) {
    validateDeviceId(id);
    return this._run('select-output', async signal => {
      if (id) {
        requireValue(this.state.capabilities.outputSelection, 'OUTPUT_SELECTION_UNSUPPORTED');
        requireValue((await this._discover(signal)).outputs.some(d => d.id === id), 'NO_OUTPUT');
      }
      const elements = [...this.playbacks].map(p => p.element);
      if (this.output) elements.push(this.output.element);
      try {
        for (const element of elements) await this._route(element, id, signal);
      } catch (error) {
        // A timed-out setSinkId can complete later. Stop all affected playback.
        this._releaseOutput('routing-failed');
        this._detachPlaybacks();
        throw error;
      }
      this._emit({ outputId: id });
    });
  }
  attachPlayback(element, stream) {
    return this._run('playback', async signal => {
      requireValue(element && typeof element.play === 'function' && stream?.getAudioTracks, 'INVALID_ARGUMENT');
      requireValue(![...this.playbacks].some(p => p.element === element), 'BUSY');
      requireValue((await this._discover(signal)).outputs.length, 'NO_OUTPUT');
      const playback = { element };
      try {
        element.pause();
        element.volume = this.state.volume;
        await this._route(element, this.state.outputId, signal);
        element.srcObject = stream;
        await this._wait(element.play(), signal, () => {
          element.pause(); element.srcObject = null;
        });
        this.playbacks.add(playback);
        playback.unwatch = this._watchPlayback(element, () => this._detachPlayback(playback));
      } catch (error) { element.pause(); element.srcObject = null; throw error; }
      return () => {
        if (this.playbacks.has(playback)) this._detachPlayback(playback);
      };
    });
  }
  _detachPlaybacks() {
    for (const playback of this.playbacks) {
      this._detachPlayback(playback);
    }
    this.playbacks.clear();
  }
  testMicrophone({ durationMs = 3000 } = {}) {
    requireValue(Number.isFinite(durationMs) && durationMs >= 200 && durationMs <= 10000, 'INVALID_ARGUMENT');
    let result;
    return this._run('test-input', async signal => {
      requireValue(!this.output, 'BUSY');
      const graph = await this._acquireInput(signal, 'test');
      const samples = new Float32Array(graph.analyser.fftSize);
      const summary = { kind: 'microphone', frames: 0, signalFrames: 0, maxRms: 0, maxPeak: 0,
        signalDetected: false, elapsedMs: 0 };
      graph.summary = summary;
      graph.startedAt = performance.now();
      result = new Promise(resolve => { graph.resolve = resolve; });
      graph.interval = setInterval(() => {
        try {
          graph.analyser.getFloatTimeDomainData(samples);
          let squares = 0, peak = 0;
          for (const value of samples) { squares += value * value; peak = Math.max(peak, Math.abs(value)); }
          const rms = Math.sqrt(squares / samples.length);
          const dbFS = rms > 0 ? 20 * Math.log10(rms) : null;
          summary.frames++;
          if (dbFS !== null && dbFS > -50) summary.signalFrames++;
          summary.maxRms = Math.max(summary.maxRms, rms);
          summary.maxPeak = Math.max(summary.maxPeak, peak);
          summary.signalDetected = summary.signalFrames >= 3;
          this._emit({ meter: { rms, peak, dbFS, signalDetected: summary.signalDetected } });
        } catch {
          this._releaseInput('AUDIO_FAILED');
          this._emit({ error: { code: 'AUDIO_FAILED' } });
        }
      }, 50);
      graph.timer = setTimeout(() => this._releaseInput('completed'), durationMs);
      // Configure owned timers before notifying UI, which can unmount/cancel here.
      this._emit({ testing: 'microphone', meter: null });
    }).then(() => result);
  }
  testPlayback({ durationMs = 1000 } = {}) {
    requireValue(Number.isFinite(durationMs) && durationMs >= 200 && durationMs <= 5000, 'INVALID_ARGUMENT');
    let result;
    return this._run('test-output', async signal => {
      requireValue(!this.output, 'BUSY');
      requireValue(this.input?.owner !== 'test', 'BUSY');
      requireValue((await this._discover(signal)).outputs.length, 'NO_OUTPUT');
      const graph = { nodes: [] };
      try {
        graph.context = this.createContext();
        graph.oscillator = graph.context.createOscillator();
        graph.oscillator.frequency.value = 440;
        graph.gain = graph.context.createGain();
        graph.gain.gain.value = 0.12;
        graph.destination = graph.context.createMediaStreamDestination();
        graph.stream = graph.destination.stream;
        graph.nodes = [graph.oscillator, graph.gain, graph.destination];
        graph.oscillator.connect(graph.gain);
        graph.gain.connect(graph.destination);
        graph.element = this.createElement();
        graph.element.volume = this.state.volume;
        await this._route(graph.element, this.state.outputId, signal);
        graph.element.srcObject = graph.stream;
        await this._wait(graph.context.resume(), signal);
        requireValue(graph.context.state === 'running', 'AUDIO_INTERRUPTED');
        graph.oscillator.start();
        await this._wait(graph.element.play(), signal, () => {
          graph.element.pause(); graph.element.srcObject = null; releaseGraph(graph);
        });
        this.output = graph;
        this._watchContext(graph, () => this._releaseOutput('AUDIO_INTERRUPTED'));
        const unwatchContext = graph.unwatch;
        const unwatchPlayback = this._watchPlayback(graph.element, () => this._releaseOutput('DEVICE_UNAVAILABLE'));
        graph.unwatch = () => { unwatchContext(); unwatchPlayback(); };
        result = new Promise(resolve => { graph.resolve = resolve; });
        graph.timer = setTimeout(() => this._releaseOutput('completed'), durationMs);
        this._emit({ testing: 'playback' });
      } catch (error) { releaseGraph(graph); throw error; }
    }).then(() => result);
  }
  _releaseInput(reason) {
    const graph = this.input;
    if (!graph) return;
    this.input = null;
    releaseGraph(graph);
    graph.resolveClosed(Object.freeze({ leaseId: graph.leaseId, reason }));
    const interrupted = !['completed', 'cancelled', 'released', 'disposed'].includes(reason);
    this._emit({ capture: { status: interrupted ? 'interrupted' : 'idle', owner: graph.owner,
      leaseId: graph.leaseId, reason } });
    if (graph.summary) {
      const result = { ...graph.summary, elapsedMs: Math.round(performance.now() - graph.startedAt), reason };
      this._emit({ testing: this.output ? 'playback' : null, meter: null, lastTest: result });
      graph.resolve(result);
    }
  }
  _releaseOutput(reason) {
    const graph = this.output;
    if (!graph) return;
    this.output = null;
    releaseGraph(graph);
    const result = { kind: 'playback', reason, playbackStarted: true, audibilityConfirmed: false };
    this._emit({ testing: this.input?.owner === 'test' ? 'microphone' : null, lastTest: result });
    graph.resolve?.(result);
  }
  stopTests() {
    this._cancel('test-input');
    this._cancel('test-output');
    if (this.input?.owner === 'test') this._releaseInput('cancelled');
    this._releaseOutput('cancelled');
  }
  suspend() {
    this.suspended = true;
    this._cancel();
    this._releaseInput(this.disposed ? 'disposed' : 'suspended');
    this._releaseOutput(this.disposed ? 'disposed' : 'suspended');
    this._detachPlaybacks();
    this._emit({ suspended: true, disposed: this.disposed, error: { code: this.disposed ? 'DISPOSED' : 'SUSPENDED' } });
  }
  resume() {
    requireValue(!this.disposed, 'DISPOSED');
    requireValue(!this.lifecycleBlocks.size, 'SUSPENDED');
    this.suspended = false;
    this._emit({ suspended: false, error: null });
    // Never reopen a microphone or restart audio automatically after wake/lock.
    return this.refreshDevices();
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.suspend();
    this.mediaDevices?.removeEventListener('devicechange', this.onDeviceChange);
    this.unsubscribeLifecycle?.();
    this.listeners.clear();
  }
}
