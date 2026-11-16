import { randomUUID } from 'node:crypto';

const statuses = new Set(['configuring', 'registering', 'registered', 'ready', 'rejected', 'degraded']);
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const host = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

function fail(code) { throw new Error(code); }

function publicTrunk(value) {
  if (!value || !uuid.test(value.id) || typeof value.id !== 'string' ||
      typeof value.registrar_host !== 'string' || !host.test(value.registrar_host) ||
      !Number.isInteger(value.registrar_port) || value.registrar_port < 1 || value.registrar_port > 65535 ||
      value.auth_mode !== 'registration_credentials' || !statuses.has(value.status)) fail('INVALID_RESPONSE');
  return {
    id: value.id, registrar: `${value.registrar_host}:${value.registrar_port}`,
    auth_mode: value.auth_mode, status: value.status,
  };
}

export function createTrunkHttp({ origin, token, fetchImpl = fetch }) {
  let base;
  try { base = new URL(origin); } catch { /* unconfigured */ }
  if (base?.protocol !== 'https:' || base.username || base.password || base.href !== base.origin + '/') base = null;
  let bearer = typeof token === 'string' && /^[A-Za-z0-9._~+/=-]{1,512}$/.test(token) ? token : null;

  async function request(method, route, expected, body) {
    if (!base) fail('BACKEND_UNCONFIGURED');
    if (!bearer) fail('INVALID_SESSION');
    let response;
    try {
      response = await fetchImpl(new URL(route, base), {
        method, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10_000),
        headers: {
          accept: 'application/json', authorization: `Bearer ${bearer}`,
          ...(body ? { 'content-type': 'application/json', 'idempotency-key': randomUUID() } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch { fail('BACKEND_UNREACHABLE'); }
    if (response.status !== expected) {
      await response.body?.cancel().catch(() => {});
      switch (response.status) {
        case 401: bearer = null; fail('INVALID_SESSION'); break;
        case 403: fail('ACCESS_DENIED'); break;
        case 404: fail('TRUNK_OR_ROUTE_NOT_FOUND'); break;
        case 400: case 413: case 415: fail('INVALID_TRUNK'); break;
        case 409: fail('TRUNK_CONFLICT'); break;
        case 429: fail('RATE_LIMITED'); break;
        default: fail('BACKEND_UNREACHABLE');
      }
    }
    try { return await response.json(); }
    catch { fail('INVALID_RESPONSE'); }
  }

  return {
    async list() {
      const result = await request('GET', '/v1/trunks', 200);
      if (!Array.isArray(result?.items)) fail('INVALID_RESPONSE');
      return result.items.map(publicTrunk);
    },
    async create(input) {
      const endpoint = typeof input?.registrar === 'string' && input.registrar.match(/^([^:]+):(\d{1,5})$/);
      const validField = (value, max) => typeof value === 'string' && value.length > 0 &&
        value.length <= max && !Array.from(value).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
      if (!endpoint || !host.test(endpoint[1]) || Number(endpoint[2]) < 1 || Number(endpoint[2]) > 65535 ||
          input.auth_mode !== 'registration_credentials' || !validField(input.login, 128) ||
          !validField(input.password, 256)) fail('INVALID_TRUNK');
      return publicTrunk(await request('POST', '/v1/trunks', 202, {
        name: 'UIS', auth_mode: 'registration_credentials', registrar_host: endpoint[1].toLowerCase(),
        registrar_port: Number(endpoint[2]), username: input.login, password: input.password,
      }));
    },
    async remove(id) {
      if (typeof id !== 'string' || !uuid.test(id)) fail('INVALID_TRUNK');
      const result = await request('DELETE', `/v1/trunks/${id}`, 202);
      if (result?.id !== id || result.deleted !== true) fail('INVALID_RESPONSE');
    },
  };
}
