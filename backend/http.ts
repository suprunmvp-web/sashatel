import { createServer, type IncomingMessage } from 'node:http';
import { ApiError, ControlPlane } from './control.ts';

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') {
    throw new ApiError(415, 'JSON_REQUIRED');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > 4096) throw new ApiError(413, 'BODY_TOO_LARGE');
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString());
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error();
    return value;
  } catch {
    throw new ApiError(400, 'INVALID_JSON');
  }
}

function field(value: unknown, limit: number) {
  if (typeof value !== 'string' || !value.length || value.length > limit) {
    throw new ApiError(400, 'INVALID_FIELD');
  }
  return value;
}

export function createApi(control: ControlPlane, ready: () => Promise<unknown>) {
  const requests = new Map<string, number>();
  let window = 0;
  return createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    res.setHeader('cache-control', 'no-store');
    const send = (status: number, data: unknown) => {
      res.writeHead(status);
      res.end(JSON.stringify(data));
    };
    try {
      const path = req.url?.split('?')[0] ?? '';
      if (req.method === 'GET' && path === '/health') {
        await ready();
        return send(200, { status: 'ready' });
      }
      const now = Math.floor(Date.now() / 60_000);
      if (now !== window) {
        requests.clear();
        window = now;
      }
      const login = req.method === 'POST' && path === '/v1/sessions';
      const key = (req.socket.remoteAddress ?? 'unknown') + (login ? ':login' : ':api');
      const count = (requests.get(key) ?? 0) + 1;
      if (count > (login ? 10 : 120) || (!requests.has(key) && requests.size >= 10_000)) {
        throw new ApiError(429, 'RATE_LIMITED');
      }
      requests.set(key, count);
      if (login) {
        const data = await body(req);
        return send(201, await control.login(field(data.organization_id, 36), field(data.login, 254),
          field(data.password, 256), field(data.device_id, 36)));
      }
      const bearer = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
      if (!bearer) throw new ApiError(401, 'INVALID_SESSION');
      if (req.method === 'DELETE' && path === '/v1/session') {
        await control.logout(bearer);
        return send(200, { revoked: true });
      }
      if (path === '/v1/calls' && req.method === 'POST') {
        const data = await body(req);
        return send(202, await control.authorize(bearer, field(req.headers['idempotency-key'], 128),
          field(data.destination, 16)));
      }
      if (path === '/v1/calls' && req.method === 'GET') {
        return send(200, await control.calls(bearer));
      }
      const call = path.match(/^\/v1\/calls\/([^/]+)(\/hangup)?$/);
      if (call && req.method === 'GET' && !call[2]) return send(200, await control.calls(bearer, call[1]));
      if (call && req.method === 'POST' && call[2]) return send(202, await control.hangup(bearer, call[1]));
      throw new ApiError(404, 'ROUTE_NOT_FOUND');
    } catch (error) {
      if (error instanceof ApiError) return send(error.status, { code: error.code, message: error.message });
      send(503, { code: 'UNAVAILABLE', message: 'Control plane unavailable' });
    }
  });
}
