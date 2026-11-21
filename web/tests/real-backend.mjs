import pg from '../../.integration/backend/node_modules/pg/lib/index.js';
import {WebAuth} from '../../.integration/backend/web-auth.ts';
import {ControlPlane} from '../../.integration/backend/control.ts';
import {createApi} from '../../.integration/backend/http.ts';
import {randomBytes} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
// Isolated test provider ports, REAL pinned Backend/PostgreSQL.
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
const sink='/tmp/sashatel-web-mail';await mkdir(sink,{recursive:true,mode:0o700});
const auth=new WebAuth(pool,randomBytes(32),{async send(message){await writeFile(sink+'/'+message.id+'.json',JSON.stringify(message),{mode:0o600});}},{
  async lookup(inn){
    return inn==='7707083893'?{legal_name:'ООО «Проверка интеграции»',legal_address:'Тестовый lookup port'}:null;
  },
  // Isolated test fixture, not compiled into the Web release or production Backend.
  async suggest(query){
    if(!'7707083893'.startsWith(query))return [];
    return [
      {inn:'7707083893',legal_name:'ООО «Проверка интеграции»',legal_address:'Тестовый lookup port'},
      {inn:'7707000002',legal_name:'ООО «Вторая тестовая организация»',legal_address:'Тестовый адрес'},
    ].filter(item=>item.inn.startsWith(query));
  },
});
const server=createApi(new ControlPlane(pool),async()=>pool.query('SELECT 1'),undefined,{auth,origin:'http://localhost:4174'});
server.listen(8080,'127.0.0.1');
const timer=setInterval(()=>auth.deliverOne().catch(()=>{}),100);
process.on('SIGTERM',()=>{clearInterval(timer);server.close(()=>pool.end());});
