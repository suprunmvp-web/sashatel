import test from 'node:test';
import assert from 'node:assert/strict';
import { DesktopCallOwner, AUDIO_ERROR_CODES } from '../../src/index.js';
import { NUMBER, flush, runIsolated } from '../helpers.js';
import { createHarness } from './harness.js';

async function start(h, client) {
  const result = await client.send(client.command('start', { number: NUMBER }));
  assert.equal(result.ok, true);
  await flush();
  return result.callId;
}

test('two renderers and 2x click share one owner; start submission is not connected', async t => {
  const h = createHarness(); t.after(() => h.close());
  const a = h.renderer(), b = h.renderer();
  const [first, duplicate, otherWindow] = await Promise.all([
    a.send(a.command('start', { number: NUMBER })),
    a.send(a.command('start', { number: NUMBER })),
    b.send(b.command('start', { number: NUMBER })),
  ]);
  assert.equal(first.ok, true);
  assert.equal(duplicate.error?.code, 'BUSY');
  assert.equal(otherWindow.error?.code, 'BUSY');
  assert.equal(h.transport.starts.length, 1);
  const id = first.callId;
  h.transport.finishSetup(id); await flush();
  assert.equal(h.owner.getSnapshot().call.state, 'connecting');
  assert.equal(h.transport.emit(id, 'ringing'), true);
  h.clock.advance(50);
  assert.equal(h.owner.getSnapshot().call.durationMs, 0);
  assert.equal(h.transport.emit(id, 'connected'), true);
  h.clock.advance(1000);
  assert.equal(h.owner.getSnapshot().call.durationMs, 1000);
  assert.equal(h.transport.emit(id, 'remote-ended'), true);
  await flush();
  assert.equal(h.owner.getSnapshot().call.state, 'terminating');
  h.transport.confirmCleanup(id); await flush();
  assert.equal(h.owner.getSnapshot().call.state, 'ended');
  assert.equal(h.owner.getSnapshot().safety, 'ready');
  assert.deepEqual(a.snapshots, b.snapshots);
});

test('reload revokes old renderer; new renderer reattaches to the SAME call', async t => {
  const h = createHarness(); t.after(() => h.close());
  const old = h.renderer();
  const id = await start(h, old);
  h.transport.finishSetup(id); h.transport.emit(id, 'connected');
  const queuedEnd = old.command('end', { callId: id });
  old.disconnect(); old.disconnect();
  const replacement = h.renderer();
  assert.equal(replacement.snapshots[0].call.callId, id);
  assert.equal(replacement.snapshots[0].call.state, 'active');
  assert.equal((await old.send(queuedEnd)).error?.code, 'SESSION_CLOSED');
  assert.equal(old.port.getSnapshot().error?.code, 'SESSION_CLOSED');
  assert.equal((await replacement.send(replacement.command('start', { number: NUMBER }))).error?.code, 'BUSY');
  assert.equal(h.transport.terminations.length, 0);
  await replacement.send(replacement.command('end', { callId: id })); await flush();
  assert.equal(h.transport.terminations.length, 1);
});

test('terminate before start: same-tick cancel never originates, ghost connected cannot resurrect it', async t => {
  const h = createHarness(); t.after(() => h.close());
  const client = h.renderer();
  const result = client.port.request(client.command('start', { number: NUMBER }));
  client.port.request(client.command('end', { callId: result.callId }));
  await flush();
  assert.equal(h.transport.starts.length, 0);
  assert.equal(h.transport.terminations.length, 1);
  assert.ok(h.transport.fenced.has(result.callId));
  assert.equal(h.transport.lateSip2xx(result.callId), false);
  h.transport.confirmCleanup(result.callId); await flush();
  assert.equal(h.owner.getSnapshot().call.connectedAt, null);
  assert.equal(h.owner.getSnapshot().call.state, 'ended');
});

test('aborted setup, conceptual CANCEL/late 2xx ACK+BYE, late cleanup and stale events', async t => {
  const h = createHarness(); t.after(() => h.close());
  const client = h.renderer();
  const id = await start(h, client);
  await client.send(client.command('end', { callId: id })); await flush();
  assert.equal(h.transport.starts[0].signal.aborted, true);
  assert.equal(h.transport.finishSetup(id), false);
  assert.equal(h.transport.resources.size, 0);
  assert.equal(h.transport.lateSip2xx(id), false);
  assert.deepEqual(h.transport.actions.filter(([name]) => name.endsWith('-required')), [
    ['ACK-required', id], ['BYE-required', id],
  ]);
  h.clock.advance(50);
  const quarantined = h.owner.getSnapshot();
  assert.equal(quarantined.safety, 'cleanup-unconfirmed');
  assert.equal(quarantined.call.reason, 'termination-timeout');
  assert.equal(h.transport.terminations[0].signal.aborted, true);
  assert.equal((await client.send(client.command('start', { number: NUMBER }))).error?.code, 'CLEANUP_UNCONFIRMED');
  client.disconnect();
  const reloaded = h.renderer();
  assert.equal(reloaded.snapshots[0].safety, 'cleanup-unconfirmed');
  assert.equal((await reloaded.send(reloaded.command('start', { number: NUMBER }))).error?.code, 'CLEANUP_UNCONFIRMED');
  h.transport.confirmCleanup(id); await flush();
  assert.equal(h.owner.getSnapshot().safety, 'ready');
  assert.equal(h.owner.getSnapshot().call.reason, quarantined.call.reason);
  const next = await start(h, reloaded);
  assert.notEqual(next, id);
  assert.equal(h.transport.emit(id, 'connected'), false);
  assert.equal(h.transport.emit(id, 'remote-ended'), false);
  assert.equal((await reloaded.send(reloaded.command('end', { callId: id }))).error?.code, 'STALE_CALL');
  assert.equal(h.owner.getSnapshot().call.callId, next);
});

for (const phase of ['connecting', 'ringing']) {
  test(`owner exposes controlled ${phase} timeout and pending cleanup`, async t => {
    const h = createHarness(); t.after(() => h.close());
    const client = h.renderer();
    const id = await start(h, client);
    if (phase === 'ringing') h.transport.emit(id, 'ringing');
    h.clock.advance(phase === 'ringing' ? 200 : 100); await flush();
    assert.equal(h.owner.getSnapshot().call.state, 'terminating');
    assert.equal(h.transport.emit(id, 'connected'), false);
    h.transport.confirmCleanup(id); await flush();
    assert.equal(h.owner.getSnapshot().call.state, 'failed');
    assert.equal(h.owner.getSnapshot().call.reason, phase === 'ringing' ? 'ring-timeout' : 'setup-timeout');
  });
}

test('lost response retransmission cannot redial after call ends; IDs cannot change command meaning', async t => {
  const h = createHarness(); t.after(() => h.close());
  const client = h.renderer();
  const command = client.command('start', { number: NUMBER });
  const original = await client.send(command); await flush();
  assert.deepEqual(await client.send(command), original);
  const conflicting = { ...command, number: '+74951234567' };
  assert.equal((await client.send(conflicting)).error?.code, 'REQUEST_CONFLICT');
  const end = client.command('end', { callId: original.callId });
  const endResult = await client.send(end); await flush();
  h.transport.confirmCleanup(original.callId); await flush();
  assert.deepEqual(await client.send(end), endResult);
  assert.deepEqual(await client.send(command), original);
  assert.equal(h.transport.starts.length, 1);
  assert.equal(h.transport.terminations.length, 1);
  assert.equal(h.owner.getSnapshot().call.state, 'ended');
});

test('version, epoch, malformed, oversized and unauthorized commands are rejected before effects', async t => {
  const h = createHarness(); t.after(() => h.close());
  const client = h.renderer();
  const command = client.command('start', { number: NUMBER });
  for (const raw of [null, [], {}, 3, { ...command, type: 'connected' },
    { ...command, type: 'force-unlock' }, { ...command, emit: {} },
    { ...command, callId: 'extra' }, { ...command, requestId: ' '.repeat(20) },
    { ...command, requestId: 'a'.repeat(97) }, { ...command, ownerId: 'x'.repeat(129) },
    { ...command, number: '9'.repeat(129) }, { ...command, number: 79991234567 },
    client.command('end', { callId: '' }), client.command('end', { callId: 'a'.repeat(257) }),
    { get type() { throw Error('hostile'); } }]) {
    assert.equal(client.port.request(raw).error?.code, 'INVALID_COMMAND');
  }
  assert.equal((await client.send({ ...command, protocolVersion: 2 })).error?.code, 'VERSION_MISMATCH');
  assert.equal((await client.send({ ...command, ownerId: 'previous-process-epoch' })).error?.code, 'OWNER_CHANGED');
  assert.equal((await client.send({ ...command, number: 'text' })).error?.code, 'INVALID_NUMBER');
  assert.equal(h.transport.starts.length, 0);
});

test('bounded replay journal never evicts into an accidental redial; new bound session can end call', async t => {
  const h = createHarness({ maxRequestsPerSession: 1 }); t.after(() => h.close());
  const client = h.renderer();
  const id = await start(h, client);
  assert.equal((await client.send(client.command('end', { callId: id }))).error?.code, 'SESSION_EXHAUSTED');
  const replacement = h.renderer();
  assert.equal((await replacement.send(replacement.command('end', { callId: id }))).ok, true);
  await flush();
  h.transport.confirmCleanup(id); await flush();
  assert.equal(h.owner.getSnapshot().safety, 'ready');
});

test('audio errors are advisory and correlated, never proof of SIP termination or connection', async t => {
  const h = createHarness(); t.after(() => h.close());
  const client = h.renderer();
  const id = await start(h, client);
  for (const code of AUDIO_ERROR_CODES) {
    assert.equal(h.owner.reportAudioIssue({ callId: id, code }), true);
    assert.equal(h.owner.getSnapshot().call.state, 'connecting');
    assert.equal(h.owner.getSnapshot().call.durationMs, 0);
    assert.deepEqual(h.owner.getSnapshot().audioIssue, { domain: 'audio', callId: id, code });
  }
  h.transport.finishSetup(id); h.transport.emit(id, 'connected');
  h.owner.reportAudioIssue({ callId: id, code: 'DEVICE_LOST' });
  assert.equal(h.owner.getSnapshot().call.state, 'active');
  assert.equal(h.transport.terminations.length, 0);
  assert.equal(h.owner.reportAudioIssue(null), false);
  assert.equal(h.owner.reportAudioIssue({ callId: id, code: 'raw secret error' }), false);
  assert.equal(h.owner.reportAudioIssue({ callId: 'old-audio-lease', code: 'DEVICE_LOST' }), false);
  await client.send(client.command('end', { callId: id })); await flush();
  h.clock.advance(50);
  assert.equal(h.owner.reportAudioIssue({ callId: id, code: 'DISPOSED' }), false);
  assert.equal(h.owner.getSnapshot().safety, 'cleanup-unconfirmed');
  h.transport.confirmCleanup(id); await flush();
  const next = await start(h, client);
  assert.equal(h.owner.getSnapshot().audioIssue, null);
  assert.equal(h.owner.reportAudioIssue({ callId: id, code: 'DEVICE_LOST' }), false);
  assert.notEqual(id, next);
});

test('structured-clone snapshots contain data only; errors never reveal native transport payloads', async t => {
  const h = createHarness(); t.after(() => h.close());
  const client = h.renderer();
  const id = await start(h, client);
  const snapshot = h.owner.getSnapshot();
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), structuredClone(snapshot));
  assert.ok(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.call));
  const local = client.snapshots.at(-1);
  local.call.state = 'active';
  assert.equal(h.owner.getSnapshot().call.state, 'connecting');
  h.transport.attempts.get(id).setup.reject(new Error('secret SIP credentials'));
  await flush();
  assert.equal(h.owner.getSnapshot().call.reason, 'transport-error');
  assert.equal(JSON.stringify(h.owner.getSnapshot()).includes('secret'), false);
  assert.equal(JSON.stringify(await client.send(client.command('end', { callId: id }))).includes('secret'), false);
});

test('host shutdown revokes all sessions, rejects new ports and never enables force unlock', async () => {
  const h = createHarness();
  const client = h.renderer();
  const id = await start(h, client);
  h.owner.dispose(); h.owner.dispose(); await flush();
  assert.equal(client.port.getSnapshot().error?.code, 'OWNER_CLOSED');
  assert.equal((await client.send(client.command('end', { callId: id }))).error?.code, 'OWNER_CLOSED');
  assert.equal(h.owner.getSnapshot().safety, 'closed');
  assert.equal(h.owner.reportAudioIssue({ callId: id, code: 'DEVICE_LOST' }), false);
  assert.throws(() => h.owner.attachRenderer());
  h.clock.advance(50);
  assert.equal(h.owner.getSnapshot().call.canStart, false);
  const attemptedReplacement = new DesktopCallOwner(h.transport, { clock: h.clock });
  const replacementPort = attemptedReplacement.attachRenderer();
  assert.equal(replacementPort.request({ protocolVersion: 1,
    ownerId: attemptedReplacement.getSnapshot().ownerId, requestId: 'new_owner_start',
    type: 'start', number: NUMBER }).error?.code, 'BUSY');
  attemptedReplacement.dispose();
  await h.close();
});

test('reentrant audio reports cannot reorder revisions for another renderer', async t => {
  const h = createHarness(); t.after(() => h.close());
  const a = h.renderer(), b = h.renderer();
  a.port.subscribe(snapshot => {
    if (snapshot.call.state === 'connecting' && !snapshot.audioIssue) {
      h.owner.reportAudioIssue({ callId: snapshot.call.callId, code: 'NO_INPUT' });
    }
  });
  await start(h, a);
  const revisions = b.snapshots.map(snapshot => snapshot.revision);
  assert.deepEqual(revisions, [...revisions].sort((a, b) => a - b));
  assert.equal(b.snapshots.at(-1).audioIssue.code, 'NO_INPUT');
});

test('cleanup rejection stays blocked across detach/reload and cannot be cured by Audio', () => runIsolated(async () => {
  const { createHarness } = await import('./test/integration/harness.js');
  const h = createHarness();
  const client = h.renderer();
  const result = await client.send(client.command('start', { number: NUMBER }));
  await flush();
  await client.send(client.command('end', { callId: result.callId })); await flush();
  h.transport.cleanup.get(result.callId).reject(new Error('private SDK details'));
  await flush();
  client.disconnect();
  const reloaded = h.renderer();
  assert.equal(reloaded.snapshots[0].safety, 'cleanup-unconfirmed');
  assert.equal(reloaded.snapshots[0].call.reason, 'termination-error');
  assert.equal(h.owner.reportAudioIssue({ callId: result.callId, code: 'DISPOSED' }), false);
  assert.equal((await reloaded.send(reloaded.command('start', { number: NUMBER }))).error?.code, 'CLEANUP_UNCONFIRMED');
  assert.equal(JSON.stringify(h.owner.getSnapshot()).includes('private SDK'), false);
  assert.equal(h.clock.pending.size, 0);
  h.owner.dispose();
}));

test('observer reentrancy reserves request IDs, isolates failures and preserves unsubscribe semantics', async t => {
  const h = createHarness(); t.after(() => h.close());
  const client = h.renderer();
  const command = client.command('start', { number: NUMBER });
  let reentrant;
  const off = client.port.subscribe(snapshot => {
    if (snapshot.call.state === 'connecting') reentrant = client.port.request(command);
  });
  client.port.subscribe(() => { throw Error('view failure'); });
  const original = await client.send(command); await flush();
  assert.equal(reentrant.error?.code, 'REQUEST_PENDING');
  assert.deepEqual(await client.send(command), original);
  assert.equal(h.transport.starts.length, 1);
  off(); off();
  assert.throws(() => client.port.subscribe(null), TypeError);
  const end = await client.send(client.command('end', { callId: original.callId })); await flush();
  assert.equal(end.ok, true);
  assert.equal((await client.send(client.command('end', { callId: original.callId }))).error?.code, 'NOT_ACTIVE');
  h.transport.confirmCleanup(original.callId); await flush();
  client.disconnect();
  client.port.subscribe(() => assert.fail('closed session notified'))();
});

test('late subscribers and detached listeners never receive an older queued revision', async t => {
  const h = createHarness(); t.after(() => h.close());
  const a = h.renderer(), b = h.renderer();
  const observations = [];
  const detached = [];
  let stopDetached;
  a.port.subscribe(snapshot => {
    if (snapshot.call.state !== 'connecting' || snapshot.audioIssue) return;
    h.owner.reportAudioIssue({ callId: snapshot.call.callId, code: 'NO_INPUT' });
    b.port.subscribe(value => observations.push(value.revision));
    stopDetached(); // Already captured for the current publication, now revoked.
  });
  stopDetached = b.port.subscribe(snapshot => detached.push(snapshot.revision));
  await start(h, a);
  assert.equal(observations.length, 1);
  assert.equal(observations[0], h.owner.getSnapshot().revision);
  assert.deepEqual(detached, [0]);
});

test('epoch changes require handshake; owner validation and reentrant host shutdown are controlled', async () => {
  const h = createHarness();
  const oldEpoch = h.owner.getSnapshot().ownerId;
  await h.close();
  const replacement = createHarness();
  const client = replacement.renderer();
  assert.equal((await client.send({ ...client.command('start', { number: NUMBER }), ownerId: oldEpoch })).error?.code, 'OWNER_CHANGED');
  for (const value of [0, -1, 4097, NaN, 0.5]) {
    assert.throws(() => new DesktopCallOwner(replacement.transport, { maxRequestsPerSession: value }), RangeError);
  }
  replacement.owner.dispose();
  client.port.subscribe(() => assert.fail('closed owner notified'))();
  await replacement.close();

  let closeDuringPolicy;
  const g = createHarness({ normalizeNumber: () => {
    closeDuringPolicy();
    return { ok: true, number: '+79991234567', country: 'RU' };
  } });
  closeDuringPolicy = () => g.owner.dispose();
  const gClient = g.renderer();
  assert.equal((await gClient.send(gClient.command('start', { number: NUMBER }))).error?.code, 'OWNER_CLOSED');
  await g.close();
});
