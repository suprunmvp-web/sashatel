import { CallLifecycle as SharedCore } from '../src/index.js';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

export async function flush() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

export class Clock {
  time = 0;
  serial = 0;
  pending = new Map();
  callbacks = new Map();
  now = () => this.time;
  setTimeout = (fn, ms) => {
    const id = this.serial++;
    this.pending.set(id, { fn, at: this.time + ms });
    this.callbacks.set(id, fn);
    return id; // Includes zero, to catch truthiness-based timer cleanup defects.
  };
  clearTimeout = id => { this.pending.delete(id); };
  advance(ms) {
    const target = this.time + ms;
    while (true) {
      const due = [...this.pending].sort((a, b) => a[1].at - b[1].at)[0];
      if (!due || due[1].at > target) break;
      this.time = due[1].at;
      this.pending.delete(due[0]);
      due[1].fn();
    }
    this.time = target;
  }
}

export class ControlledTransport {
  starts = [];
  stops = [];
  startImpl = () => undefined;
  terminateImpl = () => undefined;
  start(request) { this.starts.push(request); return this.startImpl(request); }
  terminate(request) { this.stops.push(request); return this.terminateImpl(request); }
  emit(type, index = this.starts.length - 1, overrides = {}) {
    const request = this.starts[index];
    return request.emit({ callId: request.callId, type, ...overrides });
  }
}

export async function fixture(options = {}) {
  const CallLifecycle = SharedCore;
  const transport = new ControlledTransport();
  const clock = new Clock();
  const core = new CallLifecycle(transport, { clock, ...options });
  return { core, transport, clock, CallLifecycle };
}

// Permanent fail-closed scenarios require a genuinely new client process, not
// a test-only unlock in production code. No shell, network or credentials used.
export function runIsolated(fn, ...args) {
  const result = spawnSync(process.execPath, ['--input-type=module'], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 10_000,
    input: `import assert from 'node:assert/strict';
      import { fixture, NUMBER, flush } from './test/helpers.js';
      await (${fn.toString()})(...${JSON.stringify(args)});`,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout || String(result.error));
}

export const NUMBER = '+7 (999) 123-45-67';

export function random(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
}
