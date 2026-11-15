import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DesktopCallOwner } from '../../packages/call-lifecycle/src/index.js';
import { TestTransport } from '../integration/test-transport.mjs';
import { installCallIPC } from '../integration/call-ipc.mjs';
import { CoreCallFacade } from '../src/core-call-facade.js';

function harness(options = {}) {
  const transport = new TestTransport();
  const owner = new DesktopCallOwner(transport, options);
  const handlers = new Map();
  const ipcMain = { handle: (name, fn) => handlers.set(name, fn), removeHandler: name => handlers.delete(name) };
  const frame = { detached: false, send: (_channel, snapshot) => listeners.forEach(fn => fn(structuredClone(snapshot))) };
  const event = { senderFrame: frame };
  const listeners = new Set();
  const host = installCallIPC({ ipcMain, owner, transport, policy: { validIPC: e => e === event }, getWindow: () => null });
  const invoke = (name, ...args) => Promise.resolve(handlers.get(name)(event, ...structuredClone(args)));
  const bridge = { getSnapshot: () => invoke('call:snapshot'), request: command => invoke('call:request', command), subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); } };
  const facade = new CoreCallFacade(bridge, true);
  return { facade, bridge, transport, owner, handlers, event, host, dispose() { facade.dispose(); host.dispose(); owner.dispose(); } };
}

test('integrated facade → authenticated IPC → real owner/core: explicit answer, double start, reload, audio and stale events', async () => {
  const h = harness();
  try {
    await h.facade.refresh();
    const [first, duplicate] = await Promise.all([h.facade.start('9991234567'), h.facade.start('9991234567')]);
    assert.equal(first.ok, true); assert.equal(duplicate.ok, false);
    const id = h.facade.getSnapshot().callId;
    assert.equal(h.transport.attempts.size, 1);
    assert.equal(h.facade.getSnapshot().connectedAt, null);
    h.transport.send(id, 'ringing');
    assert.equal(h.facade.getSnapshot().durationMs, 0);
    h.transport.send(id, 'connected');
    assert.equal(h.facade.getSnapshot().state, 'active');
    h.owner.reportAudioIssue({ callId: id, code: 'DEVICE_LOST' });
    assert.equal(h.facade.getSnapshot().state, 'active');
    h.facade.dispose();
    const reloaded = new CoreCallFacade(h.bridge, true);
    await reloaded.refresh();
    assert.equal(reloaded.getSnapshot().callId, id);
    await reloaded.endCall(id);
    assert.equal(reloaded.getSnapshot().state, 'ended');
    await reloaded.start('9991234567');
    assert.equal(h.transport.send(id, 'connected'), false);
    assert.equal(reloaded.getSnapshot().state, 'connecting');
    reloaded.dispose();
  } finally { h.dispose(); }
});

test('unconfirmed cleanup survives IPC session renewal and blocks starts until same transport confirms', async () => {
  const h = harness({ maxRequestsPerSession: 2, terminationTimeoutMs: 10 });
  try {
    await h.facade.refresh(); await h.facade.start('9991234567');
    const id = h.facade.getSnapshot().callId;
    h.transport.cleanupMode = 'pending';
    await h.facade.endCall(id);
    await new Promise(resolve => setTimeout(resolve, 30));
    await h.facade.refresh();
    assert.equal(h.facade.getSnapshot().state, 'failed');
    assert.equal(h.facade.getSnapshot().canStart, false);
    assert.equal((await h.facade.start('9991234567')).ok, false); // renew exhausted session, no replay
    assert.equal(h.facade.getSnapshot().callId, id);
    h.transport.confirmCleanup(id);
    await h.facade.refresh(); assert.equal(h.facade.getSnapshot().canStart, true);
  } finally { h.dispose(); }
});

test('IPC denies other frames, extra args and forbidden commands; stale epochs rejected', async () => {
  const h = harness();
  try {
    assert.throws(() => h.handlers.get('call:snapshot')({ senderFrame: {} }), /INVALID_CALL_REQUEST/);
    assert.throws(() => h.handlers.get('call:snapshot')(h.event, {}), /INVALID_CALL_REQUEST/);
    await h.facade.refresh();
    const common = { protocolVersion: 1, ownerId: h.owner.getSnapshot().ownerId, requestId: 'test' };
    assert.equal((await h.bridge.request({ ...common, type: 'connected' })).error.code, 'INVALID_COMMAND');
    assert.equal((await h.bridge.request({ ...common, type: 'start', number: '9991234567', ownerId: 'old' })).error.code, 'OWNER_CHANGED');
    h.host.dispose(); assert.equal(h.handlers.size, 0);
  } finally { h.dispose(); }
});

test('real Audio service lease loss reports captured callId to real owner without ending call', async () => {
  const { fixture, tick } = await import('./fakes.mjs');
  const { CallMediaPort } = await import('../src/call-media-port.js');
  const f = fixture(); const h = harness();
  try {
    await h.facade.refresh(); await h.facade.start('9991234567');
    const callId = h.facade.getSnapshot().callId;
    h.transport.send(callId, 'connected');
    const port = new CallMediaPort(f.service, issue => h.owner.reportAudioIssue(issue));
    const abort = new AbortController();
    const lease = await port.acquireInput(callId, abort.signal);
    f.raw[0].getTracks()[0].dispatchEvent(new Event('ended'));
    await lease.closed; await tick();
    assert.equal(h.owner.getSnapshot().audioIssue.code, 'DEVICE_LOST');
    assert.equal(h.owner.getSnapshot().call.state, 'active');
    assert.equal(h.owner.getSnapshot().call.canStart, false);
    assert.ok(f.raw.every(s => s.getTracks().every(t => t.readyState === 'ended')));
    assert.ok(f.contexts.every(c => c.state === 'closed'));
  } finally { f.service.dispose(); h.dispose(); }
});

test('real owner early remote termination maps to missed, never answered', async () => {
  const { historyOutcome } = await import('../src/history-mapping.js');
  const h = harness();
  try {
    await h.facade.refresh(); await h.facade.start('9991234567');
    h.transport.send(h.facade.getSnapshot().callId, 'remote-ended');
    await h.facade.refresh();
    assert.equal(historyOutcome(h.facade.getSnapshot()).status, 'missed');
  } finally { h.dispose(); }
});
