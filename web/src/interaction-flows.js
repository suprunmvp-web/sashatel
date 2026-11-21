// UI journeys for tenant management. No artificial network success, no SIP secrets in the browser.
import {notify} from './notifications.js';
const h=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const renderIcon=name=>'<span data-icon="'+name+'"></span>';
function modal(title,subtitle,body){
 const dialog=document.createElement('dialog');dialog.className='ux-flow-dialog';dialog.setAttribute('aria-label',title);
 dialog.innerHTML='<div class="ux-flow-shell"><header class="ux-flow-head"><div><h2>'+h(title)+'</h2><p>'+h(subtitle)+'</p></div><button type="button" class="ux-flow-icon" data-close aria-label="Закрыть">'+renderIcon('x')+'</button></header>'+body+'</div>';
 document.body.append(dialog);
 const close=()=>dialog.close();
 dialog.querySelector('[data-close]').addEventListener('click',close);
 dialog.addEventListener('close',()=>{dialog.remove();});
 dialog.addEventListener('click',e=>{if(e.target===dialog)close();});
 globalThis.__SashaIcons?.hydrate?.(dialog);
 dialog.showModal();
 return dialog;
}
const cleanPhone=input=>{const digits=String(input||'').replace(/\D/g,'');return digits.length===11&&['7','8'].includes(digits[0])?'+7'+digits.slice(1):digits.length>=10&&digits.length<=15?'+'+digits:null;};
export function testCallBlock({trunk={},organization={}}={}){
 const canCall=Boolean(organization.verification_status==='verified' && trunk.active===true && trunk.ready==='Готов' && trunk.registration==='Зарегистрирован' && (trunk.numbers||[]).some(n=>(n.status||'active')==='active'));
 const blocked=organization.verification_status!=='verified'?'Требуется верификация организации':!trunk.active?'Транк выключен':trunk.registration!=='Зарегистрирован'?'Нет SIP-регистрации':trunk.ready!=='Готов'?'Исходящие звонки недоступны':'Нет активных разрешённых номеров';
 return '<button type="button" class="ux-button ux-test-call-trigger" data-test-call data-call-ready="'+String(canCall)+'"'+(!canCall?' aria-describedby="ux-call-blocker"':'')+'>'+renderIcon('phone-call')+' Тестовый звонок</button>'+(!canCall?'<p id="ux-call-blocker" class="ux-call-blocker">'+h(blocked)+'</p>':'');
}
export function openTestCall({trunk={},organization={},startCall=null,onCallComplete=null}={}){
 const eligible=organization.verification_status==='verified'&&trunk.active===true&&trunk.registration==='Зарегистрирован'&&trunk.ready==='Готов'&&(trunk.numbers||[]).some(n=>(n.status||'active')==='active');
 const contents='<div class="ux-flow-ready">'+renderIcon('headphones')+' <span>Разговор будет проходить прямо в браузере</span></div><form id="ux-call-form" class="ux-flow-form"><label>Номер для звонка<input name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="+7 999 123-45-67" required></label><div class="ux-mic-row"><span>'+renderIcon('mic')+' Микрофон браузера</span><button type="button" class="ux-inline-action" data-mic-check>Проверить</button></div><p class="ux-mic-status" role="status">Перед звонком потребуется разрешить доступ к микрофону.</p><div class="ux-call-session" hidden><span class="ux-call-indicator"></span><strong data-call-phase>Подготовка вызова</strong><span data-call-duration></span></div><p class="ux-flow-hint" role="status" data-preflight>'+(eligible?'Номер Caller ID выбирается автоматически из карусели.':'Вызов доступен после верификации организации и готовности транка.')+'</p><div class="ux-flow-footer"><button type="button" class="ux-button ux-button-secondary" data-cancel>Отмена</button><button type="submit" class="ux-button" data-call-submit disabled>'+renderIcon('phone-call')+' Позвонить</button><button type="button" class="ux-button ux-button-danger" data-hangup hidden>Завершить</button></div></form>';
 const dialog=modal('Тестовый звонок',h(trunk.name||'Проверка работы телефонии'),contents),form=dialog.querySelector('form');
 let stream=null,session=null,phase='idle',ticker=null,startedAt=0;
 const submit=form.querySelector('[data-call-submit]'),status=form.querySelector('.ux-mic-status'),hint=form.querySelector('[data-preflight]'),mic=form.querySelector('[data-mic-check]'),hang=form.querySelector('[data-hangup]');
 const release=()=>{if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}if(ticker)clearInterval(ticker);ticker=null;};
 const close=()=>{if(session?.hangup&&phase!=='idle')Promise.resolve(session.hangup()).catch(()=>{});release();};
 dialog.addEventListener('close',close,{once:true});
 form.querySelector('[data-cancel]').onclick=()=>dialog.close();
 const sync=()=>{submit.disabled=!eligible||!startCall||!stream||phase!=='idle';};
 sync();
 mic.addEventListener('click',async()=>{
  if(!navigator.mediaDevices?.getUserMedia){status.textContent='Микрофон недоступен. Откройте платформу по HTTPS в поддерживаемом браузере.';notify(status.textContent,'error');return;}
  mic.disabled=true;status.textContent='Запрашиваем доступ к микрофону…';
  try{stream?.getTracks().forEach(t=>t.stop());stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});status.textContent='Микрофон готов. Вы сможете разговаривать из браузера.';notify('Микрофон подключён','success');}
  catch(e){status.textContent=e?.name==='NotAllowedError'?'Доступ к микрофону запрещён в настройках браузера.':'Не удалось подключить микрофон. Проверьте устройство.';notify(status.textContent,'error');}
  finally{mic.disabled=false;sync();}
 });
 if(!startCall){hint.textContent='Проверка микрофона доступна. Реальный WebRTC-вызов появится после подключения сервера телефонии.';}
 form.addEventListener('submit',async e=>{
  e.preventDefault();if(!eligible||!startCall||!stream)return;
  const phone=cleanPhone(form.elements.phone.value);if(!phone){form.elements.phone.setCustomValidity('Проверьте номер телефона');form.reportValidity();return;}
  form.elements.phone.setCustomValidity('');phase='connecting';sync();hint.textContent='Устанавливаем соединение…';form.querySelector('.ux-call-session').hidden=false;
  form.querySelector('[data-call-phase]').textContent='Соединение';hang.hidden=false;startedAt=Date.now();
  try{
   // Transport owns authenticated signalling, allowed Caller ID selection, recording and termination.
   session=await startCall({trunkId:trunk.id,phone,stream,onState:state=>{
    if(dialog.open){form.querySelector('[data-call-phase]').textContent=state==='connected'?'Разговор':state==='ringing'?'Вызов абонента':'Соединение';}
   }});
   phase='active';ticker=setInterval(()=>{if(dialog.open)form.querySelector('[data-call-duration]').textContent=Math.floor((Date.now()-startedAt)/1000)+' c';},1000);
  }catch(err){phase='idle';hang.hidden=true;form.querySelector('.ux-call-session').hidden=true;hint.textContent='Не удалось совершить звонок. Попробуйте ещё раз.';notify('Не удалось установить соединение. '+(err?.message||''),'error');sync();}
 });
 hang.addEventListener('click',async()=>{
  if(!session?.hangup)return;hang.disabled=true;try{await session.hangup();phase='idle';hint.textContent='Звонок завершён. Запись появится в истории после обработки.';form.querySelector('[data-call-phase]').textContent='Завершено';hang.hidden=true;if(typeof onCallComplete==='function')onCallComplete();release();}
  catch{notify('Не удалось завершить вызов. Повторите действие.','error');hang.disabled=false;}
 });
 form.elements.phone.addEventListener('input',e=>e.target.setCustomValidity(''));
 return dialog;
}
export function openInvite({organization={},submitInvite=null}={}){
 const body='<form class="ux-flow-form" id="ux-invite-form"><label>Email сотрудника<input name="email" type="email" placeholder="manager@company.ru" autocomplete="off" required></label><label>Роль<select name="role"><option value="employee">Сотрудник — звонки из Desktop</option><option value="admin">Администратор — управление организацией</option></select></label><div class="ux-flow-explanation">'+renderIcon('shield-check')+'<p>Сотрудник получит письмо, подтвердит email и самостоятельно установит пароль. Руководитель не видит и не задаёт чужие пароли.</p></div><div class="ux-flow-footer"><button type="button" class="ux-button ux-button-secondary" data-cancel>Отмена</button><button type="submit" class="ux-button"'+(!submitInvite?' disabled title="Ожидается API приглашений"':'')+'>Отправить приглашение</button></div>'+(!submitInvite?'<p class="ux-flow-hint">Отправка приглашений будет доступна после подключения сервера.</p>':'')+'</form>';
 const dialog=modal('Пригласить сотрудника',h(organization.legal_name||'Доступ в организацию'),body);
 const form=dialog.querySelector('form');form.querySelector('[data-cancel]').onclick=()=>dialog.close();
 form.onsubmit=async e=>{e.preventDefault();if(!submitInvite)return;const submit=form.querySelector('[type=submit]');submit.disabled=true;try{await submitInvite({email:form.elements.email.value,role:form.elements.role.value});notify('Приглашение отправлено','success');dialog.close();}catch(err){notify(err?.message||'Не удалось отправить приглашение','error');submit.disabled=false;}};
 return dialog;
}
