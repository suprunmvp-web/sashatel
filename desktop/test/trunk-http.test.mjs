import assert from 'node:assert/strict';
import test from 'node:test';
import { createTrunkHttp } from '../integration/trunk-http.mjs';
import { installTrunkIPC } from '../integration/trunk-ipc.mjs';

const origin = 'https://backend.example';
const id = 'f73e6b67-db0e-4dbd-a151-06db50f4df1e';
const input = { registrar: 'PBX.uiscom.ru:5060', auth_mode: 'registration_credentials', login: 'fixture', password: 'fixture-secret' };
const trunk = { id, registrar_host: 'pbx.uiscom.ru', registrar_port: 5060, auth_mode: input.auth_mode, status: 'registered', password: input.password, secret_ref: 'private' };

test('IPC through HTTP adapter maps the v1 contract and projects public fields', async () => {
  const handlers = new Map();
  const requests = [];
  const api = createTrunkHttp({ origin, token: 'fixture-token', fetchImpl: async (url, options) => {
    requests.push([url.href, options]);
    if (options.method === 'POST') return Response.json({ ...trunk, status: 'configuring' }, { status: 202 });
    if (options.method === 'DELETE') return Response.json({ id, deleted: true }, { status: 202 });
    return Response.json({ items: [trunk] });
  } });
  installTrunkIPC({ handle: (channel, fn) => handlers.set(channel, fn) }, { validIPC: event => event === 'trusted' }, api);
  assert.deepEqual(await handlers.get('trunk:create')('foreign', input), { ok: false, code: 'ACCESS_DENIED' });
  assert.equal(requests.length, 0);
  const created = await handlers.get('trunk:create')('trusted', input);
  const listed = await handlers.get('trunk:list')('trusted');
  assert.deepEqual(created, { ok: true, value: { id, registrar: 'pbx.uiscom.ru:5060', auth_mode: input.auth_mode, status: 'configuring' } });
  assert.deepEqual(listed, { ok: true, value: [{ ...created.value, status: 'registered' }] });
  assert.equal((await handlers.get('trunk:remove')('trusted', id)).ok, true);
  assert.deepEqual(requests.map(([url, options]) => [url, options.method]), [
    [origin + '/v1/trunks', 'POST'], [origin + '/v1/trunks', 'GET'], [origin + '/v1/trunks/' + id, 'DELETE'],
  ]);
  const options = requests[0][1];
  assert.deepEqual(JSON.parse(options.body), {
    name: 'UIS', registrar_host: 'pbx.uiscom.ru', registrar_port: 5060,
    auth_mode: input.auth_mode, username: input.login, password: input.password,
  });
  assert.match(options.headers['idempotency-key'], /^[a-f0-9-]{36}$/);
  assert.equal(options.headers.authorization, 'Bearer fixture-token');
  assert.equal(options.redirect, 'error');
  assert.equal(options.cache, 'no-store');
  assert.equal(requests[1][1].body, undefined);
  assert.equal(requests[2][1].body, undefined);
});

test('401 clears the bearer, backend errors never echo response bodies, and bad inputs never dispatch', async () => {
  let count = 0;
  const api = createTrunkHttp({ origin, token: 'fixture-token', fetchImpl: async () => {
    count++;
    return Response.json({ message: input.password }, { status: count === 1 ? 403 : 401 });
  } });
  await assert.rejects(api.remove('../calls'), { message: 'INVALID_TRUNK' });
  await assert.rejects(api.list(), { message: 'ACCESS_DENIED' });
  await assert.rejects(api.list(), { message: 'INVALID_SESSION' });
  await assert.rejects(api.list(), { message: 'INVALID_SESSION' });
  assert.equal(count, 2);
  await assert.rejects(createTrunkHttp({ origin: 'http://backend.example', token: 'test' }).list(),
    { message: 'BACKEND_UNCONFIGURED' });
});

test('malformed status fails closed and a failed POST is sent only once', async () => {
  let count = 0;
  const api = createTrunkHttp({ origin, token: 'test', fetchImpl: async (_url, { method }) => {
    count++;
    if (method === 'POST') throw new Error(input.password);
    return Response.json({ items: [{ ...trunk, status: 'unexpected' }] });
  } });
  await assert.rejects(api.list(), { message: 'INVALID_RESPONSE' });
  await assert.rejects(api.create(input), { message: 'BACKEND_UNREACHABLE' });
  assert.equal(count, 2);
});
