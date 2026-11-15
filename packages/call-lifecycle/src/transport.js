/**
 * @typedef {'ringing'|'connected'|'remote-ended'|'rejected'|'no-answer'|'transport-error'|'connection-lost'} TransportEventType
 * @typedef {{callId: string, type: TransportEventType}} TransportEvent
 * @typedef {Object} StartRequest
 * @property {string} callId Immutable application ID, not a reusable SIP dialog ID.
 * @property {string} number Normalized E.164 destination.
 * @property {AbortSignal} signal Aborted on EVERY exit from the live phases.
 * @property {(event: unknown) => boolean} emit Scoped to this attempt. False = ignored.
 * @typedef {Object} TerminateRequest
 * @property {string} callId
 * @property {string} reason Sanitized core reason, never a SIP response body.
 * @property {AbortSignal} signal Deadline/cancellation of remote termination waiting.
 * @typedef {Object} CallTransport
 * @property {(request: StartRequest) => void | Promise<void>} start
 * Submission only: resolving MUST NOT imply connected. Emit connected only when the
 * dialog AND usable media are confirmed; provisional/early media is not connected.
 * @property {(request: TerminateRequest) => void | Promise<void>} terminate
 * MUST be safe before/during/after start, fence all pending starts for callId and
 * detach listeners, release media, sockets/dialog resources even when signal aborts.
 * Resolve ONLY when this attempt cannot originate/resume a call. Rejecting leaves
 * the core fail-closed. Handle late SIP 2xx after CANCEL with ACK/BYE internally.
 * Never put credentials or raw SIP payloads in events. See docs/call-lifecycle.md.
 */

export const TRANSPORT_EVENTS = Object.freeze([
  'ringing', 'connected', 'remote-ended', 'rejected', 'no-answer',
  'transport-error', 'connection-lost',
]);

/** Read an untrusted boundary once; malformed objects/getters cannot escape. */
export function parseTransportEvent(value) {
  try {
    if (!value || typeof value !== 'object') return null;
    const { callId, type } = value;
    if (typeof callId !== 'string' || !TRANSPORT_EVENTS.includes(type)) return null;
    return { callId, type };
  } catch {
    return null;
  }
}
