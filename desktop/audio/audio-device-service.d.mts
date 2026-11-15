/** Public renderer integration contract. No SIP/session/transport terminal state. */
export type AudioErrorCode = 'PERMISSION_DENIED' | 'NO_INPUT' | 'NO_OUTPUT' |
  'DEVICE_UNAVAILABLE' | 'DEVICE_LOST' | 'OUTPUT_SELECTION_UNSUPPORTED' | 'UNSUPPORTED' |
  'AUDIO_INTERRUPTED' | 'AUDIO_FAILED' | 'TIMEOUT' | 'CANCELLED' | 'BUSY' |
  'SUSPENDED' | 'DISPOSED' | 'INVALID_ARGUMENT';
export type SystemPermission = 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown';
export type Operation = 'discover' | 'permission' | 'select-input' | 'select-output' |
  'capture' | 'playback' | 'test-input' | 'test-output';
export type InputReleaseReason = 'completed' | 'cancelled' | 'released' | 'disposed' | 'suspended' |
  'DEVICE_LOST' | 'PERMISSION_DENIED' | 'AUDIO_INTERRUPTED' | 'AUDIO_FAILED';
export interface AudioDevice { id: string; label: string; selectable: boolean; }
export interface AudioDevices { inputs: AudioDevice[]; outputs: AudioDevice[]; }
export interface MicrophoneResult {
  kind: 'microphone'; frames: number; signalFrames: number; maxRms: number; maxPeak: number;
  signalDetected: boolean; elapsedMs: number; reason: InputReleaseReason;
}
export interface PlaybackResult {
  kind: 'playback'; reason: 'completed' | 'cancelled' | 'suspended' | 'disposed' |
    'DEVICE_LOST' | 'AUDIO_INTERRUPTED' | 'DEVICE_UNAVAILABLE' | 'routing-failed';
  playbackStarted: true; audibilityConfirmed: false;
}
export interface AudioState {
  devices: AudioDevices;
  permission: 'unknown' | 'granted' | 'denied' | 'restricted';
  systemPermission: SystemPermission;
  inputId: string; outputId: string; inputGain: number; volume: number;
  operation: Operation | null; suspended: boolean; disposed: boolean;
  capture: { status: 'idle' | 'active' | 'interrupted'; owner: 'transport' | 'test' | null;
    leaseId: number | null; reason: InputReleaseReason | null };
  testing: 'microphone' | 'playback' | null;
  meter: { rms: number; peak: number; dbFS: number | null; signalDetected: boolean } | null;
  lastTest: MicrophoneResult | PlaybackResult | null;
  error: { code: AudioErrorCode } | null;
  capabilities: { outputSelection: boolean; systemMicrophoneGain: false; softwareInputGain: true };
}
export interface InputLease {
  readonly stream: MediaStream;
  /** Resolves once when this media lease is released; NEVER a SIP-ended event. */
  readonly closed: Promise<Readonly<{ leaseId: number; reason: InputReleaseReason }>>;
  release(): void;
}
export interface AudioBridge {
  getMicrophonePermission(): Promise<SystemPermission>;
  requestMicrophonePermission(): Promise<boolean>;
  onLifecycle(listener: (event: 'suspend' | 'resume' | 'locked' | 'unlocked') => void): () => void;
}
export interface AudioServiceOptions {
  mediaDevices?: Pick<MediaDevices, 'enumerateDevices' | 'getUserMedia' | 'addEventListener' | 'removeEventListener'>;
  createContext?: () => AudioContext;
  createElement?: () => HTMLAudioElement;
  bridge?: AudioBridge;
  timeoutMs?: number;
}
export declare class AudioDeviceService {
  constructor(options?: AudioServiceOptions);
  getState(): AudioState;
  subscribe(listener: (state: AudioState) => void | Promise<void>): () => void;
  refreshDevices(): Promise<AudioDevices>;
  requestPermission(): Promise<'granted'>;
  selectInput(id: string): Promise<void>;
  selectOutput(id: string): Promise<void>;
  acquireInput(): Promise<InputLease>;
  setInputGain(value: number): void;
  setPlaybackVolume(value: number): void;
  attachPlayback(element: HTMLMediaElement, stream: MediaStream): Promise<() => void>;
  testMicrophone(options?: { durationMs?: number }): Promise<MicrophoneResult>;
  testPlayback(options?: { durationMs?: number }): Promise<PlaybackResult>;
  stopTests(): void;
  suspend(): void;
  resume(): Promise<AudioDevices>;
  dispose(): void;
}
