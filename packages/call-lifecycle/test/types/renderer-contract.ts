import {
  DesktopCallOwner, CallLifecycle, normalizeRussianNumber,
  type RendererPort, type RendererCommand, type OwnerSnapshot, type UIError,
  type CallTransport, type RendererCallAPI, type AudioIssue,
} from '@sashatel/call-lifecycle';

const transport: CallTransport = {
  start({ callId, signal, emit, number }) {
    const e164: string = number;
    if (!signal.aborted) emit({ callId, type: 'ringing' });
    void e164;
    // Compilation fixture only, not instantiated by tests or shipped to production.
  },
  async terminate({ callId, reason, signal }) { void [callId, reason, signal]; },
};
const owner = new DesktopCallOwner(transport, { connectTimeoutMs: 100 });
const core = new CallLifecycle(transport);
const port: RendererPort = owner.attachRenderer();
const command: RendererCommand = {
  protocolVersion: 1, ownerId: owner.getSnapshot().ownerId,
  requestId: 'attempt_1', type: 'start', number: '+79991234567',
};
const result = port.request(command);
if (result.ok) {
  port.request({ protocolVersion: 1, ownerId: command.ownerId, requestId: 'end_1', type: 'end', callId: result.callId });
} else {
  const error: UIError = result.error;
  if (error.domain === 'call') {
    const code: 'BUSY' | 'CLEANUP_UNCONFIRMED' | 'INVALID_NUMBER' | 'STALE_CALL' | 'NOT_ACTIVE' = error.code;
    void code;
  }
}
const observe = (snapshot: OwnerSnapshot) => {
  const timestamp: number | null = snapshot.call.connectedAt;
  const audio: AudioIssue | null = snapshot.audioIssue;
  void [timestamp, audio];
};
port.subscribe(observe)();
owner.reportAudioIssue({ callId: 'captured-lease-call-id', code: 'DEVICE_LOST' });
normalizeRussianNumber('8 (999) 123-45-67');
core.endCall('specific-call-id');

// Future preload bridge is asynchronous; these assignments verify its shape.
const bridge: RendererCallAPI = {
  request: async command => port.request(command),
  getSnapshot: async () => port.getSnapshot(),
  subscribe: listener => port.subscribe(listener),
};
void bridge;

// Negative compile contracts MUST fail compilation if an API becomes permissive.
// @ts-expect-error missing call ID on end
port.request({ protocolVersion: 1, ownerId: 'owner', requestId: 'end_1', type: 'end' });
// @ts-expect-error renderer cannot emit transport events
port.request({ protocolVersion: 1, ownerId: 'owner', requestId: 'x', type: 'connected' });
// @ts-expect-error force unlock is never part of renderer protocol
port.request({ protocolVersion: 1, ownerId: 'owner', requestId: 'x', type: 'force-unlock' });
// @ts-expect-error new wire protocol requires explicit negotiation
port.request({ protocolVersion: 2, ownerId: 'owner', requestId: 'x', type: 'start', number: 'x' });
// @ts-expect-error immutable snapshot
owner.getSnapshot().call.state = 'active';
// @ts-expect-error no arbitrary native error / credentials in advisory audio data
owner.reportAudioIssue({ callId: 'a', code: 'my raw error' });
// @ts-expect-error Audio cannot confirm SIP completion
const invalidAudio: AudioIssue = { domain: 'audio', callId: 'a', code: 'ended' };
// @ts-expect-error cross-domain error codes are invalid
const invalidError: UIError = { domain: 'protocol', code: 'CLEANUP_UNCONFIRMED' };
// @ts-expect-error no transport handles or MediaStreams in wire snapshot
const illegalSnapshot: OwnerSnapshot = { ...owner.getSnapshot(), transport };
void [invalidAudio, invalidError, illegalSnapshot];
