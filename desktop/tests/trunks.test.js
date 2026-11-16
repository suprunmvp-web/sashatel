import assert from 'node:assert/strict';
import test from 'node:test';
import { createMockTrunkApi } from '../src/mock-trunk-api.js';

const input = {
  registrar: 'pbx.uiscom.ru:5060', login: 'fixture', password: 'fixture-secret',
  auth_mode: 'registration_credentials',
};

test('mock projects public metadata, never reports ready, and removes idempotently', async () => {
  const api = createMockTrunkApi();
  const created = await api.create(input);
  assert.deepEqual(created, {
    id: '1', registrar: input.registrar, auth_mode: input.auth_mode, status: 'degraded',
  });
  assert.deepEqual(await api.list(), [created]);
  assert.deepEqual(await api.retry(created.id), created);
  await api.remove(created.id);
  await api.remove(created.id);
  await assert.rejects(api.retry(created.id), /TRUNK_NOT_FOUND/);
  assert.deepEqual(await api.list(), []);
});

test('mock rejects invalid registrar and duplicate creation', async () => {
  const api = createMockTrunkApi();
  await assert.rejects(api.create({ ...input, registrar: '127.0.0.1:5060' }), /INVALID_TRUNK/);
  await api.create(input);
  await assert.rejects(api.create(input), /TRUNK_EXISTS/);
});
