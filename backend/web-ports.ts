import { mkdir, writeFile } from 'node:fs/promises';
import type { LookupPort,MailPort } from './web-auth.ts';

export class EmailSink implements MailPort {
  readonly directory:string;
  constructor(directory:string) {this.directory=directory;}
  async send(message:{id:string;email:string;code:string|null}) {
    await mkdir(this.directory,{recursive:true,mode:0o700});
    await writeFile(this.directory+'/'+message.id+'.json',JSON.stringify(message),{mode:0o600,flag:'w'});
  }
}
export class DaDataLookup implements LookupPort {
  readonly key:string;
  constructor(key:string) {this.key=key;}
  async suggest(query:string) {
    const response=await fetch('https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/party',{
      method:'POST',
      headers:{'content-type':'application/json',accept:'application/json',authorization:'Token '+this.key},
      body:JSON.stringify({query,count:20}),
      signal:AbortSignal.timeout(5000),
    });
    if(!response.ok) throw new Error('DaData suggestions unavailable');
    const data=await response.json();
    if(!Array.isArray(data?.suggestions)) throw new Error('Invalid DaData suggestions');
    const seen=new Set<string>();
    const items:{inn:string;legal_name:string;legal_address:string}[]=[];
    for(const suggestion of data.suggestions) {
      const party=suggestion?.data;
      const inn=party?.inn;
      const name=party?.name?.full_with_opf;
      if(typeof inn!=='string'||!/^(?:[0-9]{10}|[0-9]{12})$/.test(inn)||!inn.startsWith(query)||
         typeof name!=='string'||!name.trim()||seen.has(inn)||
         (party.branch_type && party.branch_type!=='MAIN')) continue;
      seen.add(inn);
      items.push({inn,legal_name:name,legal_address:typeof party.address?.value==='string'?party.address.value:''});
      if(items.length===20) break;
    }
    return items;
  }
  async lookup(inn:string) {
    const response=await fetch('https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party',{
      method:'POST',headers:{'content-type':'application/json',authorization:'Token '+this.key},
      body:JSON.stringify({query:inn,branch_type:'MAIN'}),signal:AbortSignal.timeout(5000),
    });
    if(!response.ok) throw new Error('Lookup unavailable');
    const data=await response.json();
    const item=data.suggestions?.find((s:any)=>s.data?.inn===inn);
    if(!item) return null;
    const name=item.data?.name?.full_with_opf,address=item.data?.address?.value;
    if(typeof name!=='string'||typeof address!=='string') throw new Error('Invalid lookup');
    return {legal_name:name,legal_address:address};
  }
}
