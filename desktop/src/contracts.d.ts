/** UI boundary. Services own call state, elapsed time and device effects. */
export type CallState = 'idle' | 'connecting' | 'ringing' | 'active' | 'terminating' | 'ended' | 'failed';
export type Mode = 'demo' | 'live';
export interface CallSnapshot {
  /** Real registration/transport status supplied by the integration facade, never inferred from call state. */
  connection: 'unavailable' | 'disconnected' | 'connecting' | 'registered';
  state: CallState;
  callId: string | null;
  number: string;
  canStart: boolean;
  durationMs: number;
  /** Service-confirmed monotonic answer timestamp. Zero is valid; null means unconfirmed. */
  connectedAt: number | null;
  reason: string | null;
  audioIssue?: string | null;
}
export interface CommandResult { ok: boolean; error?: string }
export interface CallPort {
  readonly mode: Mode;
  getSnapshot(): Readonly<CallSnapshot>;
  subscribe(listener: (snapshot: Readonly<CallSnapshot>) => void): () => void;
  start(number: string): CommandResult | Promise<CommandResult>;
  endCall(callId: string): CommandResult | Promise<CommandResult>;
}
export type DemoEvent = 'ringing' | 'connected' | 'rejected' | 'connection-lost' | 'remote-ended';
export interface DemoControls { send(event: DemoEvent): void }
export interface AudioDevice { id: string; label: string }
export interface AudioSnapshot {
  available: boolean;
  permission: 'unknown' | 'granted' | 'denied' | 'restricted';
  outputSelection: boolean;
  inputs: readonly AudioDevice[];
  outputs: readonly AudioDevice[];
  inputId: string;
  outputId: string;
  volume: number;
  testing: 'microphone' | 'speaker' | null;
  level: number;
  message: string;
  result: string;
}
export interface AudioPort {
  getSnapshot(): Readonly<AudioSnapshot>;
  subscribe(listener: (snapshot: Readonly<AudioSnapshot>) => void): () => void;
  selectInput(id: string): Promise<void>;
  selectOutput(id: string): Promise<void>;
  setVolume(volume: number): Promise<void>;
  testMicrophone(): Promise<void>;
  testSpeaker(): Promise<void>;
  stopTest(): Promise<void>;
  requestPermission(): Promise<void>;
}
export interface DesktopServices {
  calls: CallPort;
  audio: AudioPort;
  history: HistoryPort;
  demo?: DemoControls;
}
/** Answered history requires explicit service evidence, never a terminal reason or duration. */
export type HistoryOutcome =
  | { status: 'answered'; connectedAt: number }
  | { status: 'cancelled' | 'missed' | 'failed' | 'unknown'; connectedAt: number | null };
export type HistoryItem = HistoryOutcome & {
  id: string;
  number: string;
  at: Date;
  mode: Mode;
  durationMs: number;
};
export interface HistoryPort {
  load(): Promise<readonly HistoryItem[]>;
  /** Only the session demo implements this. Live history must come from Backend. */
  recordDemo?: (item: HistoryItem) => void;
}
/** Electron host adds a fail-closed unavailable-transport result without changing Core. */
export type ElectronCallAPI = Omit<import('../../packages/call-lifecycle/src/index').RendererCallAPI, 'request'> & {
  request(command: import('../../packages/call-lifecycle/src/index').RendererCommand): Promise<
    import('../../packages/call-lifecycle/src/index').CommandResult |
    Readonly<{ ok: false; error: Readonly<{ domain: 'owner'; code: 'TRANSPORT_UNAVAILABLE' }> }>
  >;
};
declare global {
  interface Window {
    sashatel?: {
      mode: string; version: string; platform: string;
      calls: ElectronCallAPI;
      demo?: { send(value: { callId: string; event: DemoEvent }): Promise<boolean> };
      audio?: { reportIssue(value: { callId: string; code: string }): Promise<boolean> };
    };
    sashatelTrunks?: import('./trunks').TrunkBridge;
    sashatelAudio?: PublishedAudioService;
  }
}
/** Public subset of PR #3 cadb039. No capture ownership or implementation here. */
export interface PublishedAudioState {
  devices: { inputs: (AudioDevice & {selectable: boolean})[]; outputs: (AudioDevice & {selectable: boolean})[] };
  permission: AudioSnapshot['permission'];
  inputId: string;
  outputId: string;
  volume: number;
  testing: 'microphone' | 'playback' | null;
  meter: { rms: number } | null;
  lastTest: { kind: 'microphone' | 'playback'; reason: string; signalDetected?: boolean } | null;
  error: { code: string } | null;
  capabilities: { outputSelection: boolean };
}
export interface PublishedAudioService {
  getState(): PublishedAudioState;
  subscribe(listener: (state: PublishedAudioState) => void): () => void;
  selectInput(id: string): Promise<void>;
  selectOutput(id: string): Promise<void>;
  setPlaybackVolume(value: number): void;
  testMicrophone(): Promise<unknown>;
  testPlayback(): Promise<unknown>;
  stopTests(): void;
  requestPermission(): Promise<unknown>;
}
