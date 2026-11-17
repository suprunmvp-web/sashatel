// TEST ONLY: no SDK, network, microphone, registration, or real SIP messages.
import assert from 'node:assert/strict';
import { DesktopCallOwner } from '../../src/index.js';
import { Clock, deferred, flush } from '../helpers.js';

export class FakeTransport {
  starts = [];
  terminations = [];
  attempts = new Map();
  fenced = new Set();
  resources = new Set();
  cleanup = new Map();
  actions = [];

  start(request) {
    this.starts.push(request);
    const setup = deferred();
    this.attempts.set(request.callId, { request, setup });
    request.signal.addEventListener('abort', () => this.actions.push(['abort', request.callId]), { once: true });
    return setup.promise;
  }

  terminate(request) {
    assert.equal(this.cleanup.has(request.callId), false, 'duplicate terminate effect');
    this.fenced.add(request.callId); // Fence is synchronous, even if start has not run.
    this.terminations.push(request);
    const cleanup = deferred();
    this.cleanup.set(request.callId, cleanup);
    return cleanup.promise;
  }

  finishSetup(callId) {
    const attempt = this.attempts.get(callId);
    if (!attempt) return false;
    const mayOriginate = !attempt.request.signal.aborted && !this.fenced.has(callId);
    if (mayOriginate) this.resources.add(callId);
    else this.actions.push(['late-setup-discarded', callId]);
    attempt.setup.resolve();
    return mayOriginate;
  }

  emit(callId, type) {
    return this.attempts.get(callId)?.request.emit({ callId, type }) ?? false;
  }

  // Conceptual contract probe ONLY: records protocol duties, sends no SIP.
  lateSip2xx(callId) {
    assert.ok(this.fenced.has(callId), 'expected a canceled attempt');
    this.actions.push(['ACK-required', callId], ['BYE-required', callId]);
    return this.emit(callId, 'connected'); // Must be ignored by the real core.
  }

  confirmCleanup(callId) {
    assert.ok(this.cleanup.has(callId));
    this.resources.delete(callId);
    this.cleanup.get(callId).resolve();
  }
}

export function createHarness(options = {}) {
  const clock = new Clock();
  const transport = new FakeTransport();
  const owner = new DesktopCallOwner(transport, {
    clock, connectTimeoutMs: 100, ringTimeoutMs: 200, terminationTimeoutMs: 50, ...options,
  });
  let serial = 0;
  const renderer = () => {
    const port = owner.attachRenderer();
    const initial = port.getSnapshot().snapshot;
    const snapshots = [];
    const off = port.subscribe(snapshot => snapshots.push(structuredClone(snapshot)));
    const command = (type, fields, requestId = `request_${++serial}`) => ({
      protocolVersion: 1, ownerId: initial.ownerId, requestId, type, ...fields,
    });
    // Structured clones exercise data boundaries; this is NOT an IPC transport.
    const send = raw => Promise.resolve().then(() => structuredClone(port.request(structuredClone(raw))));
    return { port, snapshots, command, send, disconnect: () => { off(); port.disconnect(); } };
  };
  return {
    clock, transport, owner, renderer,
    async close() {
      owner.dispose();
      await flush();
      for (const [id] of transport.attempts) transport.finishSetup(id);
      for (const [id] of transport.cleanup) transport.confirmCleanup(id);
      await flush();
      assert.equal(transport.resources.size, 0);
      assert.equal(clock.pending.size, 0);
    },
  };
}
