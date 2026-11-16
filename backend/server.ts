import pg from 'pg';
import { ControlPlane, uuid } from './control.ts';
import { FakeAri } from './fake-ari.ts';
import { createApi } from './http.ts';

const { DATABASE_URL, CALL_DAY_TIMEZONE, FAKE_ARI_TENANTS, PORT = '8080' } = process.env;
if (!DATABASE_URL || !FAKE_ARI_TENANTS) throw new Error('DATABASE_URL and explicit FAKE_ARI_TENANTS are required');
const tenants = [...new Set(FAKE_ARI_TENANTS.split(','))];
if (!tenants.every(tenant => uuid.test(tenant))) throw new Error('Invalid FAKE_ARI_TENANTS');
const pool = new pg.Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 5000 });
const control = new ControlPlane(pool, CALL_DAY_TIMEZONE);
const gateway = new FakeAri();
const api = createApi(control, () => pool.query('SELECT 1 FROM control.organizations LIMIT 1'));
let running = false;
const timer = setInterval(async () => {
  if (running) return;
  running = true;
  try {
    for (const tenant of tenants) await control.processOne(tenant, gateway);
  } catch {
    console.error('Control Plane worker failed to process an outbox command');
  } finally {
    running = false;
  }
}, 250);
api.listen(Number(PORT), '127.0.0.1');
process.once('SIGTERM', () => {
  clearInterval(timer);
  api.close(() => { void pool.end(); });
});
