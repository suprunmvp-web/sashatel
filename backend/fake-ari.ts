import type { GatewayResult, GatewayState, Originate, TelephonyGateway } from './control.ts';

export class FakeAri implements TelephonyGateway {
  readonly attempts = new Map<string, GatewayState>();
  timeoutAfterAccept = false;

  async originate(command: Originate): Promise<'ringing'> {
    if (this.attempts.has(command.attemptId)) throw new Error('Duplicate originate');
    this.attempts.set(command.attemptId, 'ringing');
    if (this.timeoutAfterAccept) throw new Error('Simulated response loss');
    return 'ringing';
  }

  async hangup(attemptId: string): Promise<'unknown' | { state: 'ended'; charge: bigint }> {
    if (!this.attempts.has(attemptId)) return 'unknown';
    this.attempts.set(attemptId, 'ended');
    return { state: 'ended', charge: 0n };
  }

  async inspect(attemptId: string): Promise<GatewayResult> {
    const state = this.attempts.get(attemptId) ?? 'unknown';
    return state === 'ended' ? { state, charge: 0n } : state;
  }
}
