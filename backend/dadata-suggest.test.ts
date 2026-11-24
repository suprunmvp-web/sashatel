import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DaDataLookup} from './web-ports.ts';

test('DaData suggestions return only genuine matching, deduplicated legal entities',async()=>{
  const original=globalThis.fetch;
  let requests=0;
  globalThis.fetch=(async(input,init)=>{
    requests++;
    assert.equal(String(input),'https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/party');
    assert.equal((init?.headers as Record<string,string>).authorization,'Token test-key');
    assert.deepEqual(JSON.parse(String(init?.body)),{query:'7707',count:20});
    return new Response(JSON.stringify({suggestions:[
      {data:{inn:'7707083893',name:{full_with_opf:'ПАО Сбербанк'},address:{value:'Москва'},branch_type:'MAIN'}},
      {data:{inn:'7707083893',name:{full_with_opf:'ПАО Сбербанк'},address:{value:'Москва'},branch_type:'MAIN'}},
      {data:{inn:'7800000000',name:{full_with_opf:'Другой банк'},address:{value:'Санкт-Петербург'}}},
      {data:{inn:'7707000001',name:{full_with_opf:'Филиал'},address:{value:'Москва'},branch_type:'BRANCH'}},
      {data:{inn:'7707000002',name:{full_with_opf:'ООО Найденная организация'},address:{value:'Москва'}}},
      {data:{inn:'7707000003',name:{full_with_opf:''},address:{value:'Москва'}}},
    ]}),{status:200});
  }) as typeof fetch;
  try{
    const items=await new DaDataLookup('test-key').suggest('7707');
    assert.equal(requests,1);
    assert.deepEqual(items,[
      {inn:'7707083893',legal_name:'ПАО Сбербанк',legal_address:'Москва'},
      {inn:'7707000002',legal_name:'ООО Найденная организация',legal_address:'Москва'},
    ]);
  } finally {globalThis.fetch=original;}
});

test('DaData suggestions fail closed when upstream is unavailable',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=(async()=>new Response('{}',{status:503})) as typeof fetch;
  try {
    await assert.rejects(new DaDataLookup('test-key').suggest('7707'),/unavailable/);
  } finally {globalThis.fetch=original;}
});
