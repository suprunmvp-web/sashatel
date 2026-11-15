export type CallState = 'idle' | 'connecting' | 'ringing' | 'active' | 'terminating' | 'ended' | 'failed';
export type CallReason = 'cancelled' | 'local-hangup' | 'remote-hangup' | 'disposed' | 'rejected' |
  'no-answer' | 'transport-error' | 'connection-lost' | 'setup-timeout' | 'ring-timeout' |
  'termination-timeout' | 'termination-error';
export type TransportEventType = 'ringing' | 'connected' | 'remote-ended' | 'rejected' |
  'no-answer' | 'transport-error' | 'connection-lost';
export interface TransportEvent { readonly callId: string; readonly type: TransportEventType }
export interface StartRequest {
  readonly callId: string;
  readonly number: string;
  readonly signal: AbortSignal;
  readonly emit: (event: unknown) => boolean;
}
export interface TerminateRequest {
  readonly callId: string;
  readonly reason: CallReason;
  readonly signal: AbortSignal;
}
export interface CallTransport {
  start(request: StartRequest): void | Promise<void>;
  /** Resolve only after fencing origination and releasing session/media resources. */
  terminate(request: TerminateRequest): void | Promise<void>;
}
export type NumberError = 'invalid-type' | 'too-long' | 'empty' | 'invalid-characters' |
  'invalid-format' | 'invalid-prefix' | 'incomplete';
export type NumberResult = Readonly<{ ok: true; number: string; country: string }> |
  Readonly<{ ok: false; error: string }>;
export interface CallOptions {
  clock?: { now(): number; setTimeout(callback: () => void, ms: number): unknown; clearTimeout(id: unknown): void };
  connectTimeoutMs?: number;
  ringTimeoutMs?: number;
  terminationTimeoutMs?: number;
  normalizeNumber?: (raw: unknown) => NumberResult;
}
/** Relative monotonic milliseconds, never wall-clock dates or billable durations. */
export interface CallSnapshot {
  readonly state: CallState;
  readonly callId: string | null;
  readonly number: string | null;
  readonly startedAt: number | null;
  readonly connectedAt: number | null;
  readonly stoppedAt: number | null;
  readonly endedAt: number | null;
  readonly reason: CallReason | null;
  readonly durationMs: number;
  readonly canStart: boolean;
  readonly disposed: boolean;
}
export type CoreStartResult = Readonly<{ ok: true; callId: string }> |
  Readonly<{ ok: false; error: 'busy' | 'disposed' | 'invalid-number'; detail?: string }>;
export class CallLifecycle {
  constructor(transport: CallTransport, options?: CallOptions);
  getSnapshot(): CallSnapshot;
  subscribe(listener: (snapshot: CallSnapshot) => void): () => void;
  start(raw: unknown): CoreStartResult;
  endCall(callId: string): boolean;
  reset(): boolean;
  dispose(): void;
}
export function normalizeRussianNumber(raw: unknown): NumberResult;
export const CALL_STATES: readonly CallState[];
export const CALL_EVENTS: readonly string[];
export const TRANSITIONS: Readonly<Record<CallState, Readonly<Record<string, CallState>>>>;
export function nextState(state: string, event: string): CallState | null;
export const TRANSPORT_EVENTS: readonly TransportEventType[];
export function parseTransportEvent(raw: unknown): TransportEvent | null;

export type AudioErrorCode = 'PERMISSION_DENIED' | 'NO_INPUT' | 'NO_OUTPUT' | 'DEVICE_UNAVAILABLE' |
  'DEVICE_LOST' | 'OUTPUT_SELECTION_UNSUPPORTED' | 'UNSUPPORTED' | 'AUDIO_INTERRUPTED' |
  'AUDIO_FAILED' | 'TIMEOUT' | 'CANCELLED' | 'BUSY' | 'SUSPENDED' | 'DISPOSED' | 'INVALID_ARGUMENT';
/** Audio errors are advisory; never SIP completion or connection evidence. */
export interface AudioIssue { readonly domain: 'audio'; readonly callId: string; readonly code: AudioErrorCode }
export type UIError =
  Readonly<{ domain: 'call'; code: 'BUSY' | 'CLEANUP_UNCONFIRMED' | 'INVALID_NUMBER' | 'STALE_CALL' | 'NOT_ACTIVE' }> |
  Readonly<{ domain: 'protocol'; code: 'INVALID_COMMAND' | 'VERSION_MISMATCH' | 'REQUEST_CONFLICT' | 'REQUEST_PENDING' }> |
  Readonly<{ domain: 'owner'; code: 'OWNER_CHANGED' | 'SESSION_CLOSED' | 'OWNER_CLOSED' | 'SESSION_EXHAUSTED' }>;
export interface OwnerSnapshot {
  readonly protocolVersion: 1;
  readonly ownerId: string;
  /** Increases on lifecycle/audio changes; duration-only reads may share a revision. */
  readonly revision: number;
  readonly safety: 'ready' | 'occupied' | 'cleanup-unconfirmed' | 'closed';
  readonly call: CallSnapshot;
  readonly audioIssue: AudioIssue | null;
}
export type RendererCommand = Readonly<{ protocolVersion: 1; ownerId: string; requestId: string } & (
  { type: 'start'; number: string } | { type: 'end'; callId: string }
)>;
export type CommandResult = Readonly<{ ok: true; callId: string }> | Readonly<{ ok: false; error: UIError }>;
export type SnapshotResult = Readonly<{ ok: true; snapshot: OwnerSnapshot }> | Readonly<{ ok: false; error: UIError }>;
/** In-process host port. Real preload exposes only a narrow asynchronous facade. */
export interface RendererPort {
  request(command: RendererCommand): CommandResult;
  getSnapshot(): SnapshotResult;
  subscribe(listener: (snapshot: OwnerSnapshot) => void): () => void;
  disconnect(): void;
}
/** Future narrow preload bridge; implementation and authentication are host integration work. */
export interface RendererCallAPI {
  request(command: RendererCommand): Promise<CommandResult>;
  getSnapshot(): Promise<SnapshotResult>;
  subscribe(listener: (snapshot: OwnerSnapshot) => void): () => void;
}
export const DESKTOP_PROTOCOL_VERSION: 1;
export const AUDIO_ERROR_CODES: readonly AudioErrorCode[];
export class DesktopCallOwner {
  constructor(transport: CallTransport, options?: CallOptions & { maxRequestsPerSession?: number });
  getSnapshot(): OwnerSnapshot;
  attachRenderer(): RendererPort;
  reportAudioIssue(issue: Pick<AudioIssue, 'callId' | 'code'>): boolean;
  dispose(): void;
}
