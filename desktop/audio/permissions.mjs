import { requireValue } from './errors.mjs';

export class AudioPermissions {
  constructor(bridge) { this.bridge = bridge; }

  async status() {
    return this.bridge ? this.bridge.getMicrophonePermission() : 'unknown';
  }

  async request() {
    const status = await this.status();
    requireValue(status !== 'denied' && status !== 'restricted', 'PERMISSION_DENIED');
    if (this.bridge && status !== 'granted') {
      requireValue(await this.bridge.requestMicrophonePermission(), 'PERMISSION_DENIED');
    }
    // Chromium permission is established by getUserMedia, not by OS status alone.
  }
}
