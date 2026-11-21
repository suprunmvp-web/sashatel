import { readFile } from 'node:fs/promises';
import pg from 'pg';

export async function databasePool(urlFile: string, caFile?: string) {
  const connectionString = (await readFile(urlFile,'utf8')).trim();
  const url = new URL(connectionString);
  for (const key of ['sslmode','sslcert','sslkey','sslrootcert']) {
    if (url.searchParams.has(key)) throw new Error('Configure TLS through DATABASE_CA_FILE');
  }
  const host = url.searchParams.get('host') ?? url.hostname;
  const local = ['localhost','127.0.0.1','[::1]'].includes(host) || host.startsWith('/');
  if (!local && !caFile) throw new Error('Database CA required for remote PostgreSQL');
  const ssl = caFile ? {ca:await readFile(caFile,'utf8'),rejectUnauthorized:true} : undefined;
  const pool=new pg.Pool({connectionString,ssl,max:10,connectionTimeoutMillis:5000,
    idleTimeoutMillis:30000,query_timeout:10000,statement_timeout:10000});
  // pg emits "error" for disconnected *idle* clients; without a listener,
  // Node exits even if the connection pool could open a new connection.
  pool.on('error',error=>{
    const code=(error as {code?:unknown}).code;
    console.error(JSON.stringify({event:'postgres_idle_client_error',
      kind:error.name,code:typeof code==='string'?code:null}));
  });
  return pool;
}
