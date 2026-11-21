/** @typedef {import('./contracts').RegisterInput} RegisterInput */
/** @typedef {import('./contracts').Bootstrap} Bootstrap */
export class ApiError extends Error{
 constructor(code,message,retryAfter=0,status=0,requestId=null){super(message);Object.assign(this,{code,status,retryAfter,requestId});}
}
const messages={INVALID_PROFILE:'Проверьте имя и фамилию.',INVALID_PHONE:'Проверьте номер телефона и код страны.',INVALID_EMAIL:'Проверьте email.',INVALID_PASSWORD:'Пароль: от 8 до 128 символов.',INVALID_CREDENTIALS:'Проверьте email и пароль.',CODE_INVALID_OR_EXPIRED:'Код неверный или истёк. Запросите новый код.',RATE_LIMITED:'Лимит запросов. Повторите позже.',RESOURCE_NOT_FOUND:'Данные не найдены или недоступны.',AUTH_UNAVAILABLE:'Сервис временно недоступен. Повторите позже.',EMAIL_DELIVERY_UNAVAILABLE:'Сервис отправки писем недоступен. Предыдущий код сохраняется.',ORGANIZATION_LOOKUP_UNAVAILABLE:'Сервис реквизитов временно недоступен.',INN_INVALID:'Проверьте ИНН.',LOOKUP_EXPIRED:'Реквизиты устарели. Повторите поиск.',ORGANIZATION_ALREADY_EXISTS:'Организация с этим ИНН уже существует.',SESSION_REVOKED:'Сессия завершена. Войдите снова.',REFRESH_REUSED:'Сессия завершена. Войдите снова.',REFRESH_EXPIRED:'Сессия истекла. Войдите снова.',ORGANIZATION_CONTEXT_CHANGED:'Организация изменилась в другой вкладке. Обновите страницу.',PERMISSION_DENIED:'Недостаточно прав.',USER_REVOKED:'Доступ отозван.',EMAIL_UNVERIFIED:'Подтвердите email.',ALREADY_AUTHENTICATED:'Аккаунт уже авторизован. Обновите страницу.'};
export function createHttpApi({fetcher=globalThis.fetch.bind(globalThis),storage=globalThis.sessionStorage}={}){
 let csrf=null,csrfPromise=null,refreshPromise=null,context=null,account=null,generation=0;
 const device=(()=>{try{let id=localStorage.getItem('sashatel.web.device');if(!id){id=crypto.randomUUID();localStorage.setItem('sashatel.web.device',id);}return id;}catch{return crypto.randomUUID();}})();
 const pendingKey='sashatel.web.pending-organization';
 function pending(){try{return JSON.parse(storage.getItem(pendingKey));}catch{return null;}}
 function invalidate(){generation++;csrf=null;account=null;context=null;}
 async function raw(path,{body,key,method=body===undefined?'GET':'POST',token=csrf,signal}={}){
  let response;try{response=await fetcher('/v1'+path,{method,credentials:'same-origin',cache:'no-store',redirect:'error',headers:{...(body===undefined?{}:{'Content-Type':'application/json','X-CSRF-Token':token||''}),...(key?{'Idempotency-Key':key}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});}catch{throw new ApiError('NETWORK_UNKNOWN','Ответ не получен. Проверьте соединение и повторите.');}
  const data=response.status===204?null:await response.json().catch(()=>null);
  if(!response.ok)throw new ApiError(data?.code||'AUTH_UNAVAILABLE',messages[data?.code]||'Не удалось выполнить запрос.',Number(data?.retry_after_seconds||response.headers.get('Retry-After')||0),response.status,data?.request_id);
  if(response.status!==204&&!data)throw new ApiError('INVALID_RESPONSE','Некорректный ответ API.',0,response.status);
  return data;
 }
 async function csrfToken(){if(!csrfPromise)csrfPromise=raw('/auth/csrf').then(r=>{if(typeof r?.csrf_token!=='string')throw new ApiError('INVALID_RESPONSE','Некорректный ответ CSRF.');return csrf=r.csrf_token;}).finally(()=>{csrfPromise=null;});return csrfPromise;}
 async function refresh(){
  if(!refreshPromise){const run=async()=>{try{return await raw('/auth/bootstrap');}catch(e){if(e.code!=='ACCESS_EXPIRED')throw e;}await csrfToken();return raw('/auth/refresh',{body:{}});};
   refreshPromise=(globalThis.navigator?.locks?navigator.locks.request('sashatel.web.refresh',run):run()).finally(()=>{refreshPromise=null;});
  }return refreshPromise;
 }
 async function request(path,options={},attempt=0){const mark=generation;if(options.body!==undefined&&!csrf)await csrfToken();
  try{const data=await raw(path,options);if(mark!==generation)throw new ApiError('STALE_RESPONSE','Ответ относится к завершённой сессии.');return data;}
  catch(e){if(e.code==='CSRF_INVALID'&&attempt===0){await csrfToken();return request(path,options,1);}
   if(e.code==='ACCESS_EXPIRED'&&attempt<2){await refresh();return request(path,options,2);}
   if(['SESSION_REVOKED','REFRESH_EXPIRED','REFRESH_REUSED','USER_REVOKED'].includes(e.code))invalidate();throw e;}
 }
 async function bootstrap(){/** @type {Bootstrap} */const data=await request('/auth/bootstrap');
  if(data.verification_completion_available&&!data.account){await request('/auth/email/complete',{body:{}});return bootstrap();}
  account=data.account;context=data.context;return data;
 }
 async function view(data){const organizations=data.account?(await request('/organizations')).items:[];
  const c=data.challenge;return {account:data.account,organization:data.context?.organization||null,organizations,
   challenge:c?{id:c.challenge_id,expiresAt:Date.parse(c.expires_at),resendAt:Date.parse(c.resend_at),...c}:null,
   pendingCreate:pending()?.account_id===data.account?.id?pending():null};
 }
 let registerReceipt=null,resendReceipt=null;
 async function stableKey(payload,old){const bytes=new TextEncoder().encode(JSON.stringify(payload));const sum=await crypto.subtle.digest('SHA-256',bytes);const signature=Array.from(new Uint8Array(sum)).join(',');return old?.signature===signature?old:{signature,key:crypto.randomUUID()};}
 return {
  async resume(){return view(await bootstrap());},
  /** @param {RegisterInput} input */
  async register(input){const {first_name,last_name,email,phone,password}=input,body={first_name,last_name,email,phone,password};registerReceipt=await stableKey(body,registerReceipt);const result=await request('/auth/register',{body,key:registerReceipt.key});registerReceipt=null;return result;},
  async challengeStatus(id){return request('/auth/email/challenges/'+encodeURIComponent(id));},
  async verify(input){try{await request('/auth/email/verify',{body:input});}catch(e){if(e.code!=='NETWORK_UNKNOWN')throw e;}const data=await bootstrap();if(!data.account)throw new ApiError('VERIFICATION_PENDING','Подтверждение не завершено. Проверьте состояние и повторите.');return view(data);},
  async resend(input){resendReceipt=await stableKey(input,resendReceipt);const result=await request('/auth/email/resend',{body:input,key:resendReceipt.key});resendReceipt=null;return result;},
  async login({email,password}){await request('/auth/login',{body:{email,password,device_id:device}});return view(await bootstrap());},
  async lookup(input){return request('/organizations/lookup',{body:input});},
  async suggestOrganizations(query,{signal}={}){return request('/organizations/suggest',{body:{query},signal});},
  async createOrganization(input,key,receipt){let stored=pending();if(!stored||stored.key!==key){stored={key,payload:input,lookup:receipt,account_id:account?.id};try{storage.setItem(pendingKey,JSON.stringify(stored));}catch{}}
   else{try{const result=await request('/organizations/creation-status/'+key);storage.removeItem(pendingKey);return result;}catch(e){if(e.code!=='RESOURCE_NOT_FOUND')throw e;}}
   const result=await request('/organizations',{body:stored.payload,key});try{storage.removeItem(pendingKey);}catch{}return result;
  },
  async openOrganization(id){const result=await request('/session/organization',{body:{organization_id:id,expected_context_epoch:context?.context_epoch??null}});context=result.context;return {organization:context.organization};},
  async logout(){generation++;await request('/auth/logout',{body:{}});invalidate();},
  async organizations(){return (await request('/organizations')).items;},
  get account(){return account;},get context(){return context;},
 };
}
