/**
 * Prepared Audio → future transport boundary. It does not start calls or emit
 * connected/ended. DOM MediaStreams stay in the media realm, outside Electron IPC.
 */
export class CallMediaPort {
  /** @param {Pick<import('../audio/audio-device-service.mjs').AudioDeviceService, 'acquireInput'>} audio
   * @param {(issue: { callId: string; code: string }) => void} report */
  constructor(audio, report) { this.audio = audio; this.report = report; }
  /** Caller must await this operation during transport cleanup, including after abort.
   * @param {string} callId @param {AbortSignal} signal */
  async acquireInput(callId, signal) {
    const lease = await this.audio.acquireInput();
    if (signal.aborted) { lease.release(); throw new DOMException('Cancelled', 'AbortError'); }
    const release = () => lease.release();
    signal.addEventListener('abort', release, { once: true });
    void lease.closed.then(({ reason }) => {
      signal.removeEventListener('abort', release);
      if (['DEVICE_LOST', 'PERMISSION_DENIED', 'AUDIO_INTERRUPTED', 'AUDIO_FAILED'].includes(reason)) {
        this.report({ callId, code: reason }); // captured identity, never current UI call
      }
    });
    return lease;
  }
}
