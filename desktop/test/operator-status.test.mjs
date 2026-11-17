import assert from 'node:assert/strict';
import test from 'node:test';
import { createOperatorStatusReader, installOperatorStatusIPC } from '../integration/operator-status.mjs';

const origin = 'https://operator.example';
const now = 100_000;
const allowed = { telephony_available: true, caller_id: '+79991234567', can_call: true };
const response = (observed, body = allowed) => Response.json({ ...body, observed_at_ms: observed, ignored: 'private' });

test('IPC projects the operator read only and rejects untrusted frames', async () => {
  let handler;
  const read = createOperatorStatusReader({ origin, token: 'pilot.token', now: () => now, fetchImpl: async (url, options) => {
    assert.equal(url.href, origin + '/v1/operator/telephony');
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.headers.authorization, 'Bearer pilot.token');
    return response(now);
  } });
  installOperatorStatusIPC({ handle: (_name, fn) => { handler = fn; } },
    { validIPC: (event, args) => event.trusted && args.length === 0 }, read);
  assert.equal(await handler({ trusted: false }), null);
  assert.equal(await handler({ trusted: true }, 'extra'), null);
  assert.equal(await handler({ trusted: true, senderFrame: { detached: true } }), null);
  assert.deepEqual(await handler({ trusted: true }), {
    available: true, callerId: allowed.caller_id, canCall: true, expiresAt: now + 10_000,
  });
});

test('network loss, denied access, replay and expired replies clear the read model', async () => {
  const results = [
    () => response(now - 3),
    () => { throw new Error('offline'); },
    () => Response.json({}, { status: 403 }),
    () => response(now - 2, { ...allowed, can_call: false }),
    () => response(now - 2),
    () => response(now - 10_000),
    () => response(now - 1),
  ];
  const read = createOperatorStatusReader({ origin, token: 'pilot', now: () => now, fetchImpl: async () => results.shift()() });
  assert.equal((await read()).canCall, true);
  assert.equal(await read(), null);
  assert.equal(await read(), null);
  assert.equal((await read()).canCall, false);
  assert.equal(await read(), null);
  assert.equal(await read(), null);
  assert.equal((await read()).canCall, true);
});

test('a revoked session clears the bearer and prevents another request', async () => {
  let calls = 0;
  const read = createOperatorStatusReader({ origin, token: 'pilot', fetchImpl: async () => {
    calls++;
    return Response.json({}, { status: 401 });
  } });
  assert.equal(await read(), null);
  assert.equal(await read(), null);
  assert.equal(calls, 1);
});
