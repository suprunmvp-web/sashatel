// Explicit opt-in Demo/Test transport. No network, SIP SDK, credentials or automatic answer.
export class TestTransport {
  attempts = new Map();
  cleanupMode = 'confirmed';
  start({ callId, emit }) { this.attempts.set(callId, { emit }); }
  terminate({ callId }) {
    if (this.cleanupMode === 'rejected') return Promise.reject(new Error('TEST_CLEANUP_REJECTED'));
    if (this.cleanupMode === 'pending') return new Promise(resolve => { this.attempts.get(callId).cleanup = resolve; });
    this.attempts.delete(callId);
    return Promise.resolve();
  }
  send(callId, event) {
    if (!['ringing', 'connected', 'rejected', 'connection-lost', 'remote-ended'].includes(event)) return false;
    const attempt = this.attempts.get(callId);
    if (!attempt) return false;
    attempt.emit({ type: event, callId });
    return true;
  }
  confirmCleanup(callId) {
    const attempt = this.attempts.get(callId);
    if (!attempt?.cleanup) return false;
    attempt.cleanup(); this.attempts.delete(callId); return true;
  }
}
