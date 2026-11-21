import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { databasePool } from './db.ts';

const {MIGRATION_DATABASE_URL_FILE,DATABASE_CA_FILE,ADOPT_PILOT_SCHEMA} = process.env;
if (!MIGRATION_DATABASE_URL_FILE) throw new Error('MIGRATION_DATABASE_URL_FILE required');
const pool = await databasePool(MIGRATION_DATABASE_URL_FILE,DATABASE_CA_FILE);
const db = await pool.connect();
const files = [   '001.sql',   'runtime.sql',   '002-uis.sql',   '003-operator.sql',   '004-web.sql',   '005-trunk-routing.sql',   '006-global-carousel.sql',   '007-mail-lease.sql', '008-password-recovery.sql', '009-verified-inn-suggestions.sql', '010-internal-organization-reviews.sql', ];
try {
  await db.query("SELECT pg_advisory_lock(1935766117)");
  await db.query('CREATE TABLE IF NOT EXISTS public.sashatel_migrations (name text PRIMARY KEY,digest text NOT NULL,applied_at timestamptz NOT NULL DEFAULT clock_timestamp())');
  const {rows:[existing]} = await db.query("SELECT to_regclass('control.users') IS NOT NULL AS pilot");
  const {rows:[count]} = await db.query('SELECT count(*)::int AS value FROM public.sashatel_migrations');
  if (existing.pilot && count.value === 0 && ADOPT_PILOT_SCHEMA !== 'verified') {
    throw new Error('Existing schema requires explicit verified baseline adoption');
  }
  for (const name of files) {
    const sql = await readFile(new URL('./migrations/'+name,import.meta.url),'utf8');
    const digest = createHash('sha256').update(sql).digest('hex');
    const {rows:[record]} = await db.query('SELECT digest FROM public.sashatel_migrations WHERE name=$1',[name]);
    if (record) {
      if (record.digest !== digest) throw new Error('Migration checksum mismatch');
      continue;
    }
    await db.query('BEGIN');
    try {
      if (!(existing.pilot && count.value===0 && ADOPT_PILOT_SCHEMA==='verified' && files.indexOf(name)<4)) await db.query(sql);
      await db.query('INSERT INTO public.sashatel_migrations(name,digest) VALUES ($1,$2)',[name,digest]);
      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
  }
} finally {
  await db.query('SELECT pg_advisory_unlock(1935766117)');
  db.release();
  await pool.end();
}
