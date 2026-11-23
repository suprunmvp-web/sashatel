import {renderSettingsTabs, settingsUsersMarkup, clientInviteFields, wireClientInvite} from './cabinet-settings.js';
import {billingMarkup, invoiceFields, invoiceMethod, invoiceIcon, wireInvoiceForm} from './cabinet-billing.js';
import {renderPeriod, renderStatistics, renderCallFilters, renderCallDetails, wirePeriod} from './cabinet-reporting.js';
import {showTrunkDialog, trunkManagementMarkup, renderTrunkInformation, renderTrunkNumbers, wireTrunkNumbers, trunkLandingMarkup, renderTrunkHeader} from './trunk-dialog.js';
import {api,isPreview} from './session.js';
import {cabinetNavigation, cabinetWorkspace, cabinetProfile, cabinetFinance, verificationNotice, showCabinetWelcome} from './cabinet-shell.js';
import {notify} from './notifications.js';
import {esc,icon,link,button,table,empty,missing,tabs,metrics,hydrate} from './components.js';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const query=new URLSearchParams(location.search),previewSuffix=isPreview?'?preview=1'+(query.get('role')?'&role='+encodeURIComponent(query.get('role')):''):'';
let parts=location.pathname.split('/').filter(Boolean);const admin=parts[0]==='admin';
let account=null,org=null,organizations=[],internalOrganizations=[],internalRole=isPreview?(query.get('role')||'reviewer'):null;
if(!['admin','reviewer'].includes(internalRole))internalRole=null;
let page=admin?(parts[1]||'overview'):(parts[1]||'statistics'),service=isPreview&&query.get('service')==='1';
const nav=admin?[['overview','layout-dashboard','Обзор'],['employees','users','Сотрудники']]:[['statistics','chart-no-axes-column','Статистика'],['trunks','list-trunks','Транки'],['history','history','История звонков'],['integrations','plug','Интеграции'],['billing','credit-card','Биллинг'],['organization','settings','Настройки'],['support','message-circle','Поддержка'],['documentation','book-open','Документация']];
let collapsed=false;
try{collapsed=localStorage.getItem('sashatel.web.sidebar')==='collapsed';}catch{}
const base=()=>admin?'/admin/':'/'+org.id+'/';
const url=section=>base()+(section==='overview'||section==='statistics'?'':section+'/')+previewSuffix;
const currentNav=()=>!admin&&page==='employees'?'organization':page;
const title=()=>nav.find(n=>n[0]===currentNav())?.[2]||({profile:'Профиль',security:'Безопасность',organization:'Организация'}[page]||'Страница не найдена');
function accountPage(section){
 if(section==='profile')return '<dl class="summary">'+[['Имя',account.first_name],['Фамилия',account.last_name],['Email',account.email],['Телефон',account.phone]].map(([k,v])=>'<dt>'+k+'</dt><dd>'+esc(v??'Не указано')+'</dd>').join('')+'</dl><p class="hint">Телефон не подтверждён. Он не используется для входа и восстановления доступа.</p>';
 if(section==='security')return '<h2>Сессии и пароль</h2>'+link('/recovery/','Восстановить пароль')+button('Выйти из текущей сессии','logout');
}
function clientPage(){
 if(page==='statistics')return renderStatistics();
 if(page==='history'){
  if(parts[2])return renderCallDetails(url('history'),esc(base()+'history/'+encodeURIComponent(parts[2])+'/'),parts[3]);
  return renderCallFilters();
 }
 if(page==='trunks'){
  if(!parts[2])return trunkLandingMarkup;
  if(!uuid.test(parts[2]))return empty('Транк не найден','Проверьте адрес страницы.');
  const tab=['management','information','numbers'].includes(parts[3])?parts[3]:'management';
  const header=renderTrunkHeader(url('trunks'),base()+'trunks/'+parts[2]+'/',tab,previewSuffix);
  if(tab==='numbers')return header+renderTrunkNumbers();
  if(tab==='information')return header+renderTrunkInformation(parts[2]);
  return header+trunkManagementMarkup+'<div class="actions">'+button('Переименовать транк','trunk-rename',false,true)+button('Удалить транк','delete',true,true)+'</div>';
 }
 if(page==='employees')return renderSettingsTabs(true)+settingsUsersMarkup;
 if(page==='integrations')return '<section class="integration-unavailable">'+'<span class="integration-lock" aria-hidden="true"><img src="/assets/lock.svg" width="34" height="34" alt=""></span>'+'<p>Данный раздел находится в разработке. Мы вам сообщим, когда он появится. Благодарим за ожидание!</p></section>';
 if(page==='billing')return billingMarkup;
 if(page==='support')return '<section class="ws-help-body"><h2>Поддержка SashaTel</h2><p>Для вопросов по верификации организации и SIP-подключению обратитесь к вашему менеджеру.</p></section>';
 if(page==='documentation')return '<section class="ws-help-body"><h2>Подключение телефонии</h2><p>Создайте транк, введите данные SIP-оператора и проверьте состояние подключения во вкладке «Информация». Для звонков нужны разрешённые исходящие номера.</p>'+link(url('trunks'),'Перейти к транкам')+'</section>';
 if(page==='profile'||page==='security')return accountPage(page);
 if(page==='organization')return renderSettingsTabs(false)+'<section id="settingsGeneral" class="requisites-panel settings-panel" role="tabpanel" aria-labelledby="settingsGeneralTab"><h2>Настройки организации</h2>'+
  '<form id="wsOrgForm" class="ws-form"><label>Название организации<input type="text" id="wsOrgName" name="legal_name" maxlength="180" required value="'+esc(org.legal_name)+'"></label>'+
  '<label>ИНН<input id="wsOrgInn" type="text" inputmode="numeric" readonly value="'+esc(org.inn)+'"></label>'+
  '<div class="ws-form-actions"><button id="wsOrgSave" type="submit" class="button" disabled>Сохранить настройки</button><span id="wsOrgFeedback" role="status"></span></div></form></section>';
 return empty('Страница не найдена','Выберите раздел в меню.');
}
function adminPage(){
 if(!internalRole)return empty('Служебный доступ запрещён','Доступ к организациям есть только у сотрудников SashaTel с подтверждёнными сервером полномочиями.',true);
 if(page==='profile'||page==='security')return accountPage(page);
 if(page==='employees'){
  const fullName=[account.first_name,account.last_name].filter(Boolean).join(' ')||'—';
  const row=['<strong>'+esc(fullName)+'</strong>',esc(account.email||'—'),internalRole==='admin'?'Администратор':'Проверяющий',esc(account.phone||'—'),account.email_verified===true?'Да':account.email_verified===false?'Нет':'—','—',''];
  return '<section class="admin-staff"><div class="section-heading ux-staff-header"><span>Ваш аккаунт</span>'+
   '<label class="workspace-search">'+icon('search')+'<input id="adminStaffSearch" type="search" placeholder="Поиск сотрудника" aria-label="Поиск сотрудников"></label></div>'+
   table(['Фамилия Имя','Email','Роль','Телефон','Email подтверждён','Дата регистрации',''],[row])+'</section>';
 }
 if(page!=='overview')return empty('Страница не найдена','Выберите раздел в меню.');
 const filter='<label class="workspace-search admin-org-search">'+icon('search')+'<input type="search" id="organization-filter" aria-label="Поиск организации" placeholder="Название или ИНН"></label>';
 const labels={unverified:'Нет',verified:'Да',rejected:'Отклонена'};
 const membershipIds=new Set(organizations.map(item=>item.id));
 const managerFilter='<div class="admin-manager-filter"><label for="orgManagerFilter">Ответственный</label>'+
  '<button type="button" id="orgManagerFilter" class="button secondary" disabled>Все менеджеры '+icon('chevron-down')+'</button></div>';
 const rows=internalOrganizations.map(o=>[
  membershipIds.has(o.id)
   ? '<a class="admin-org-link" data-open-org="'+esc(o.id)+'" href="/'+encodeURIComponent(o.id)+'/'+esc(previewSuffix)+'">'+esc(o.legal_name||'Без названия')+'</a>'
   : '<strong>'+esc(o.legal_name||'Без названия')+'</strong>',
  '<span class="mono">'+esc(o.inn||'—')+'</span>',
  '<span class="admin-verification" data-verified="'+String(o.verification_status==='verified')+'">'+icon(o.verification_status==='verified'?'circle-check':'shield-off')+esc(labels[o.verification_status]||'—')+'</span>',
  '—',
  '—',
  o.verification_status==='unverified'
   ? '<button type="button" class="button secondary" data-review-org="'+esc(o.id)+'" data-review-decision="verified">Подтвердить</button> <button type="button" class="button secondary" data-review-org="'+esc(o.id)+'" data-review-decision="rejected">Отклонить</button>'
   : '—'
 ]);
 const analytics='<section class="cabinet-admin-analytics" aria-labelledby="admin-analytics-title"><div class="section-heading"><h2 id="admin-analytics-title">Показатели платформы</h2>'+renderPeriod()+'</div>'+
  '<dl class="metrics"><div><dt>Организации</dt><dd>'+new Intl.NumberFormat('ru-RU').format(internalOrganizations.length)+'</dd></div>'+
  '<div><dt>Потрачено минут</dt><dd>—</dd></div><div><dt>Выручка фактическая</dt><dd>—</dd></div></dl>'+
  '<h3>Тарифицируемые минуты по дням</h3><div class="cabinet-admin-chart" aria-label="Нет данных по минутам"></div></section>';
 return analytics+'<section class="cabinet-admin-organizations"><div class="section-heading"><h2>Организации</h2></div><div class="admin-org-toolbar">'+managerFilter+filter+'</div>'+
   table(['Организация','ИНН','Верификация','Ответственный менеджер','Минут потрачено','Действия'],rows,'Организаций нет')+
   '<nav class="admin-org-pager" aria-label="Страницы организаций"><span role="status"></span><button type="button" class="button secondary" data-step="-1">Назад</button><button type="button" class="button secondary" data-step="1">Вперёд</button></nav></section>';
}
function pageAction(){
 if(admin){
  if(internalRole!=='admin')return '';
  if(page==='employees')return button(icon('plus')+' Добавить сотрудника','internal-invite');
  return '';
 }
 if(org.role==='employee'||parts[2])return '';
 if(page==='statistics')return renderPeriod();
 if(page==='billing')return button(invoiceIcon+' Пополнение по счёту','invoice');
 return '';
}
function render({focus=true}={}){
 document.body.className='platform'+(collapsed?' sidebar-collapsed':'');
 document.documentElement.dataset.theme=savedTheme();
 const heading=esc(title());
 const content=admin?adminPage():org.role==='employee'
  ?empty('Кабинет организации','Управление доступно Владельцу и Администратору. Звонки — в Desktop.')
  :clientPage();
 document.body.innerHTML='<a class="skip" href="#content">К содержанию</a><aside class="sidebar" id="cabinet-sidebar">'+
  '<button type="button" class="icon-button drawer-close" data-action="close-drawer" aria-label="Закрыть меню">'+icon('x')+'</button>'+
  cabinetWorkspace({admin,org,organizations})+(admin&&internalRole==='admin'?'<button class="button admin-create-client" type="button" data-action="client" aria-label="Создать клиента">'+icon('plus')+'<span>Создать клиента</span></button>':'')+cabinetNavigation({admin,nav,current:currentNav(),url})+(admin?'':cabinetFinance())+cabinetProfile({account,org,url,internalRole:admin?internalRole:null})+'</aside>'+
  '<button type="button" class="drawer-scrim" data-action="close-drawer" aria-label="Закрыть меню" tabindex="-1" hidden></button>'+
  '<div class="platform-body"><header class="platform-top"><div class="platform-heading">'+
  '<button type="button" class="icon-button" data-action="sidebar" aria-label="Меню кабинета" aria-controls="cabinet-sidebar" aria-expanded="'+(!collapsed&&!matchMedia('(max-width:768px)').matches)+'">'+icon('panel-left')+'</button>'+
  '<span class="platform-crumb">SashaTel</span>'+icon('chevron-right')+'<strong>'+heading+'</strong></div>'+
  '<div class="top-controls">'+(isPreview?'<span class="fixture-badge">Preview · fixture</span>':'')+
  '<button type="button" class="icon-button" data-action="theme" aria-label="Переключить тему">'+icon(savedTheme()==='dark'?'sun':'moon')+'</button></div></header>'+
  (service?'<div class="service-banner">Служебный доступ · '+esc(account.first_name+' '+account.last_name)+' · '+link('/admin/?preview=1','Вернуться в обзор')+'</div>':'')+
  '<main id="content" tabindex="-1">'+(!admin?verificationNotice(org.verification_status):'')+
  ((!admin&&page==='trunks'&&(!parts[2]||uuid.test(parts[2]))&&org.role!=='employee')?'':'<div class="page-heading"><h1 tabindex="-1">'+heading+'</h1>'+pageAction()+'</div>')+'<div id="page-content">'+content+'</div>'+
  '<p id="platform-error" class="error" role="alert" tabindex="-1" hidden></p></main></div><dialog aria-labelledby="dialog-title" id="operation-dialog"></dialog>';
 hydrate();wire();
 if(focus)document.querySelector('h1')?.focus({preventScroll:true});
}
function setDrawer(open){
 document.body.classList.toggle('drawer-open',open);
 document.querySelector('.drawer-scrim').hidden=!open;
 document.querySelector('.platform-body').inert=open;
 const toggle=document.querySelector('[data-action=sidebar]');
 toggle.setAttribute('aria-expanded',String(open));
 (open?document.querySelector('.drawer-close'):toggle).focus({preventScroll:true});
}
document.addEventListener('keydown',event=>{
 if(event.key==='Escape'&&document.body.classList.contains('drawer-open')&&!document.querySelector('dialog[open], :popover-open'))setDrawer(false);
});
matchMedia('(max-width:768px)').addEventListener('change',event=>{
 if(!document.body.classList.contains('platform'))return;
 if(document.body.classList.contains('drawer-open'))setDrawer(false);
 document.querySelector('[data-action=sidebar]').setAttribute('aria-expanded',String(!event.matches&&!collapsed));
});
// Section navigation stays inside the cabinet. Auth bootstrap is required only on initial load.
function cabinetPath(pathname){
 const segments=pathname.split('/').filter(Boolean);
 if(admin)return segments[0]==='admin';
 return Boolean(org&&segments[0]===org.id);
}
function navigate(pathname){
 parts=pathname.split('/').filter(Boolean);
 page=admin?(parts[1]||'overview'):(parts[1]||'statistics');
 document.title=title()+' — SashaTel';
 render();
}
document.addEventListener('click',event=>{
 if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||!account)return;
 const anchor=event.target.closest('a[href]');
 if(!anchor||anchor.target||anchor.hasAttribute('download'))return;
 const target=new URL(anchor.href,location.href);
 if(target.origin!==location.origin||!cabinetPath(target.pathname)||!cabinetPath(location.pathname))return;
 if(target.pathname===location.pathname&&target.search===location.search)return;
 event.preventDefault();
 history.pushState(null,'',target.pathname+target.search+target.hash);
 navigate(target.pathname);
});
addEventListener('popstate',()=>{
 if(!account)return;
 if(cabinetPath(location.pathname))navigate(location.pathname);
 else location.reload();
});
function savedTheme(){try{return localStorage.getItem('sashatel.web.theme')==='light'?'light':'dark';}catch{return 'dark';}}
function operation(action){
 const dialog=document.querySelector('#operation-dialog');
 const trunkKind={trunk:'create','trunk-sip':'sip','trunk-rename':'rename'}[action];
 if(trunkKind){
  showTrunkDialog(dialog,trunkKind,()=>showError('Не удалось выполнить действие. Попробуйте ещё раз.'));
  return;
 }
 let name='',fields='',warning='',submit='Подтвердить';
 const field=(label,name,type='text')=>'<label>'+label+'<input name="'+name+'" type="'+type+'" required></label>';
 if(action==='internal-invite'){
  name='Добавить сотрудника';submit='Добавить';
  fields=`<div class="admin-dialog-form"><label>Фамилия Имя<input id="uxStaffName" type="text" required placeholder="Имя и фамилия"/></label><label>Email<input id="uxStaffEmail" type="email" required placeholder="name@sashatel.example"/></label><label>Телефон<input id="uxStaffPhone" type="tel" placeholder="+7 ..."/></label><label>Имя пользователя в Telegram<input id="uxStaffTelegram" maxlength="33" placeholder="@username"/></label></div>`+
   '<fieldset class="ux-role-choices"><legend>Внутренняя роль</legend>'+
   '<label class="ux-role-choice"><input type="radio" name="uxStaffRole" value="reviewer" checked><span><strong>Проверяющий</strong><small>Проверка организаций, фиксация решения и основания</small></span></label>'+
   '<label class="ux-role-choice"><input type="radio" name="uxStaffRole" value="admin"><span><strong>Администратор</strong><small>Внутренний администратор SashaTel</small></span></label></fieldset>';
 }
 if(action==='invite'){
  name='Пригласить сотрудника';
  submit='Добавить пользователя';
  fields=clientInviteFields;
 }
 if(action==='integration'){name='Создать интеграцию';fields='<label>Тип<select><option>amoCRM</option><option>Битрикс24</option><option>Webhook/API</option></select></label>';}
 if(action==='invoice'){name='Пополнение по счёту';submit='Сформировать счёт';fields=invoiceFields;}
 if(action==='client'){
  name='Создать клиента';submit='Создать клиента';
  fields='<label>Название организации<input name="name" maxlength="180" placeholder="ООО «Название»" required></label>'+
   '<label>ИНН<input name="inn" inputmode="numeric" pattern="[0-9]{10}|[0-9]{12}" placeholder="10 или 12 цифр" required></label>'+
   '<label>Ответственный менеджер<select disabled><option>Не назначен</option></select></label>';
 }
 if(action==='admin-actions'){name='Действия организации';fields='<label>Операция<select id="admin-operation"><option value="credit">Пополнить баланс</option><option value="debit">Списать баланс</option>'+ (internalRole==='manager'?'':'<option value="payment-date">Изменить дату оплаты</option>')+'<option value="verify">Верифицировать</option><option value="unverify">Снять верификацию</option></select></label>'+field('Положительная сумма, ₽ / день оплаты','amount','number')+field('Основание','reason');warning='Изменение влияет на доступность новых звонков или расчёты. Уже выставленные документы не пересчитываются. Снятие верификации запретит активацию транков. Текущие разговоры не прерываются.';}
 const trigger=document.activeElement;
 dialog.innerHTML='<form method="dialog"><header><h2 id="dialog-title">'+esc(name)+'</h2><button class="icon-button" formnovalidate value="cancel" aria-label="Закрыть">'+icon('x')+'</button></header>'+
  (warning?'<p class="cabinet-muted">'+esc(warning)+'</p>':'')+'<div class="dialog-fields">'+fields+'</div>'+
  (action==='invoice'?invoiceMethod:'')+'<footer class="dialog-actions"><button class="button secondary" formnovalidate value="cancel">Отмена</button><button class="button" value="submit">'+esc(submit)+'</button></footer></form>';
 const form=dialog.querySelector('form');
 const validInvoice=action==='invoice'?wireInvoiceForm(form,org?.inn):null;
 form.onsubmit=event=>{
  if(event.submitter?.value!=='submit')return;
  event.preventDefault();
  if(validInvoice&&!validInvoice())return;
  showError(action==='invoice'?'Не удалось сформировать счёт. Попробуйте ещё раз.':'Не удалось выполнить действие. Попробуйте ещё раз.');
 };
 hydrate(dialog);dialog.showModal();
 dialog.querySelector('[name=secret]')?.setAttribute('autocomplete','new-password');
 if(action==='invite')wireClientInvite(form);
 if(action==='admin-actions'){const select=dialog.querySelector('#admin-operation');const amount=dialog.querySelector('[name=amount]');select.onchange=()=>{amount.closest('label').hidden=['remove-limit','verify','unverify'].includes(select.value);};select.onchange();}
 dialog.onclose=()=>{dialog.querySelectorAll('input').forEach(el=>{el.value='';});dialog.replaceChildren();trigger?.focus({preventScroll:true});};
}
function reviewOrganizationDialog(id,decision){
 const organization=internalOrganizations.find(o=>o.id===id);
 if(!organization||organization.verification_status!=='unverified')return;
 const dialog=document.querySelector('#operation-dialog');
 dialog.innerHTML='<form id="internal-review-form"><header><h2 id="dialog-title">'+
    (decision==='verified'?'Верифицировать':'Отклонить')+' организацию</h2>'+
    '<button type="button" class="icon-button" data-review-close aria-label="Закрыть">'+icon('x')+'</button></header>'+
    '<p><strong>'+esc(organization.legal_name)+'</strong> · ИНН '+esc(organization.inn)+'</p>'+
    '<div class="dialog-fields"><label>Проверенные документы / основание<input name="evidence" maxlength="500" minlength="5" required></label>'+
    '<label>Комментарий проверки<textarea name="explanation" minlength="8" maxlength="2000" required></textarea></label></div>'+
    '<p class="warning">ИНН сам по себе не подтверждает полномочия. '+(decision==='verified'?'После подтверждения другие заявки с тем же ИНН нельзя верифицировать.':'При отклонении организация не сможет пользоваться телефонией.')+'</p>'+
    '<button class="button" type="submit">'+(decision==='verified'?'Подтвердить организацию':'Отклонить организацию')+'</button></form>';
 hydrate(dialog);
 dialog.querySelector('[data-review-close]').onclick=()=>dialog.close();
 dialog.querySelector('form').onsubmit=async(event)=>{
   event.preventDefault();
   const form=event.currentTarget;
   if(!form.reportValidity())return;
   const submit=form.querySelector('[type="submit"]');
   submit.disabled=true;
   try{
     await api.reviewOrganization(id,decision,form.elements.evidence.value.trim(),form.elements.explanation.value.trim());
     internalOrganizations=await api.internalOrganizations();
     dialog.close();
     render();
     notify(decision==='verified'?'Организация верифицирована':'Заявка отклонена','success');
   }catch(error){showError(error.message||'Не удалось провести проверку.');submit.disabled=false;}
 };
 dialog.onclose=()=>{dialog.replaceChildren();};
 dialog.showModal();
}
function showError(message){notify(message,'error');}
function wireWorkspacePicker(){
 const picker=document.querySelector('#workspace-picker');
 if(!picker)return;
 const search=picker.querySelector('input');
 picker.addEventListener('toggle',event=>{
   if(event.newState==='open')search.focus({preventScroll:true});
 });
 if(!admin&&!isPreview)void api.internalSession().then(({role})=>{
   if(!['admin','reviewer'].includes(role))return;
   picker.querySelector('.workspace-admin').hidden=false;
   picker.querySelector('.workspace-admin-divider').hidden=false;
 }).catch(()=>{});
 const options=[...picker.querySelectorAll('[data-select-org]')];
 if(search)search.oninput=()=>{
   const query=search.value.trim().toLocaleLowerCase('ru');
   for(const option of options)option.hidden=!(option.textContent+' '+option.dataset.inn).toLocaleLowerCase('ru').includes(query);
   picker.querySelector('.workspace-no-results').hidden=options.some(option=>!option.hidden);
 };
 for(const option of options)option.onclick=async()=>{
   for(const row of options)row.disabled=true;
   try{
     const result=await api.openOrganization(option.dataset.selectOrg);
     location.assign('/'+result.organization.id+'/'+previewSuffix);
   }catch(error){
     for(const row of options)row.disabled=false;
     showError(error.message);
   }
 };
}
function wire(){
 const settingsTabs=document.querySelector('.settings-tabs');
 if(settingsTabs){
  const tabs=[...settingsTabs.querySelectorAll('[role=tab]')];
  function selectSettings(index){
   const target=url(index?'employees':'organization');
   if(location.pathname!==new URL(target,location.href).pathname){
    history.pushState(null,'',target);
    navigate(location.pathname);
   }
   document.querySelector(index?'#settingsUsersTab':'#settingsGeneralTab')?.focus();
  }
  tabs.forEach((tab,index)=>tab.onclick=()=>selectSettings(index));
  settingsTabs.onkeydown=event=>{
   const keys={ArrowLeft:tabs[0]===event.target?1:0,ArrowRight:tabs[0]===event.target?1:0,Home:0,End:1};
   if(!Object.hasOwn(keys,event.key))return;
   event.preventDefault();
   selectSettings(keys[event.key]);
  };
 }
 const orgForm=document.querySelector('#wsOrgForm');
 if(orgForm){
  const name=orgForm.elements.legal_name;
  const submit=orgForm.querySelector('#wsOrgSave');
  const feedback=orgForm.querySelector('#wsOrgFeedback');
  orgForm.oninput=()=>{
   submit.disabled=!name.value.trim()||name.value.trim()===org.legal_name;
   feedback.textContent='';
  };
  orgForm.onsubmit=event=>{
   event.preventDefault();
   if(submit.disabled)return;
   feedback.textContent='Не удалось сохранить название.';
  };
 }
 wireWorkspacePicker();
 wirePeriod(document);
 wireTrunkNumbers(document);
 const resultToggle=document.querySelector('#callsResultToggle');
 if(resultToggle){
  const menu=document.querySelector('#callsResultMenu');
  for(const label of ['Все результаты','Дозвон','Автоответчик','Недозвон','Отклонено','Ошибка','Не распознано']){
   const option=document.createElement('button');
   option.type='button';option.textContent=label;
   option.onclick=()=>{document.querySelector('#callsResultLabel').textContent=label;menu.hidden=true;resultToggle.setAttribute('aria-expanded','false');resultToggle.focus();};
   menu.append(option);
  }
  resultToggle.onclick=()=>{menu.hidden=!menu.hidden;resultToggle.setAttribute('aria-expanded',String(!menu.hidden));if(!menu.hidden)menu.firstElementChild.focus();};
  menu.onkeydown=event=>{if(event.key==='Escape'){menu.hidden=true;resultToggle.setAttribute('aria-expanded','false');resultToggle.focus();}};
 }
 document.querySelectorAll('[data-action]').forEach(el=>el.onclick=async()=>{
 const action=el.dataset.action;
 if(action==='close-drawer'){setDrawer(false);return;}
 if(action==='sidebar'&&matchMedia('(max-width:768px)').matches){setDrawer(true);return;}
 if(action==='sidebar'){collapsed=!collapsed;try{localStorage.setItem('sashatel.web.sidebar',collapsed?'collapsed':'expanded');}catch{}document.body.classList.toggle('sidebar-collapsed',collapsed);el.setAttribute('aria-expanded',String(!collapsed));return;}
 if(action==='theme'){const value=savedTheme()==='dark'?'light':'dark';try{localStorage.setItem('sashatel.web.theme',value);}catch{}document.documentElement.dataset.theme=value;el.innerHTML=icon(value==='dark'?'sun':'moon');hydrate(el);return;}
 if(action==='logout'){el.disabled=true;try{await api.logout();location.assign('/login/');}catch(e){el.disabled=false;showError(e.message);}return;}
 operation(action);
 });
 document.querySelectorAll('[data-review-org]').forEach(el=>el.onclick=()=>{
   reviewOrganizationDialog(el.dataset.reviewOrg,el.dataset.reviewDecision);
 });
 wireAdminOrganizationList();
 const staffSearch=document.querySelector('#adminStaffSearch');
 if(staffSearch)staffSearch.oninput=()=>{
  const row=document.querySelector('.admin-staff tbody tr');
  row.hidden=!row.textContent.toLocaleLowerCase('ru').includes(staffSearch.value.trim().toLocaleLowerCase('ru'));
 };
}
function wireAdminOrganizationList(){
 const section=document.querySelector('.cabinet-admin-organizations');
 if(!section)return;
 const search=section.querySelector('input[type=search]');
 const tbody=section.querySelector('tbody');
 const pager=section.querySelector('.admin-org-pager');
 const [previous,next]=pager.querySelectorAll('button');
 const rows=[...tbody.rows].filter(row=>!row.querySelector('.table-empty'));
 for(const link of tbody.querySelectorAll('[data-open-org]'))link.onclick=async event=>{
  if(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
  event.preventDefault();
  if(link.getAttribute('aria-busy')==='true')return;
  link.setAttribute('aria-busy','true');
  try{
   const result=await api.openOrganization(link.dataset.openOrg);
   location.assign('/'+encodeURIComponent(result.organization.id)+'/'+previewSuffix);
  }catch(error){showError(error.message);}
  finally{link.removeAttribute('aria-busy');}
 };
 const columns=[...section.querySelectorAll('th')];
 const pageSize=10;
 const collator=new Intl.Collator('ru',{numeric:true,sensitivity:'base'});
 let current=0, sortColumn=-1, ascending=true;
 function update(){
  const query=search.value.trim().toLocaleLowerCase('ru');
  const matches=rows.filter(row=>row.textContent.toLocaleLowerCase('ru').includes(query));
  if(sortColumn>=0)matches.sort((a,b)=>collator.compare(a.cells[sortColumn].textContent,b.cells[sortColumn].textContent)*(ascending?1:-1));
  for(const row of rows)row.hidden=true;
  const start=current*pageSize;
  for(const row of matches.slice(start,start+pageSize)){row.hidden=false;tbody.append(row);}
  pager.querySelector('[role=status]').textContent=matches.length?`${start+1}–${Math.min(start+pageSize,matches.length)} из ${matches.length}`:'Организации не найдены';
  previous.disabled=current===0;
  next.disabled=(current+1)*pageSize>=matches.length;
 }
 for(const index of [0,1,2]){
  const header=columns[index],control=document.createElement('button');
  control.type='button';
  control.className='org-sort';
  control.textContent=header.textContent;
  header.replaceChildren(control);
  control.onclick=()=>{
   ascending=index!==sortColumn||!ascending;
   columns[sortColumn]?.removeAttribute('aria-sort');
   sortColumn=index;
   header.setAttribute('aria-sort',ascending?'ascending':'descending');
   current=0;
   update();
  };
 }
 search.oninput=()=>{current=0;update();};
 previous.onclick=()=>{current--;update();};
 next.onclick=()=>{current++;update();};
 update();
}
async function start(){
 const legalPages={
   '/legal/terms/':'Пользовательское соглашение',
   '/legal/privacy/':'Политика обработки персональных данных'
 };
 const legalTitle=legalPages[location.pathname];
 if(legalTitle){
   document.title=legalTitle+' — SashaTel';
   document.querySelector('main').innerHTML='<section class="legal-page"><p class="legal-eyebrow">ЮРИДИЧЕСКИЕ ДОКУМЕНТЫ</p><h1>'+esc(legalTitle)+'</h1><p>Документ готовится к публикации. Здесь будет размещена его действующая редакция.</p><a href="/register/">Вернуться к регистрации</a></section>';
   return;
 }
 if(location.pathname.startsWith('/recovery')){await import('./recovery.js');return;}
 try{
  const session=await api.resume();account=session?.account;organizations=session?.organizations||[];
  if(!account){await import('./auth.js');return;}
  if(admin){
    if(!isPreview){
      const internal=await api.internalSession();
      internalRole=internal.role;
      internalOrganizations=await api.internalOrganizations();
    }
    render();return;
  }
  if(uuid.test(parts[0]||'')){
    org=session.organization?.id===parts[0]?session.organization:(await api.openOrganization(parts[0])).organization;
    render();
    if (page === 'statistics' && ['owner', 'admin'].includes(org.role)) {
      showCabinetWelcome({account, org, organizationUrl: url('organization'), openTrunk: () => {
        history.pushState(null, '', url('trunks'));
        navigate(location.pathname);
        operation('trunk');
      }});
    }
    return;
  }
  // Authenticated users never stay on /login/ or /register/.
  // Prefer the last server-selected organization, otherwise enter the only available one.
  if(session.organization){location.replace('/'+session.organization.id+'/');return;}
  if(organizations.length===1){
    const selected=await api.openOrganization(organizations[0].id);
    location.replace('/'+selected.organization.id+'/');
    return;
  }
  // Multiple organizations need an explicit choice; zero organizations go to onboarding.
  await import('./auth.js');
 }catch(e){const code=Number(e.status)||({'PERMISSION_DENIED':403,'USER_REVOKED':403,'RESOURCE_NOT_FOUND':404,'ACCESS_EXPIRED':401,'AUTH_UNAVAILABLE':503,'NETWORK_UNKNOWN':503}[e.code]||503);
 const label=({401:'Требуется авторизация',403:'Доступ запрещён',404:'Страница не найдена',429:'Слишком много запросов',500:'Внутренняя ошибка сервера',503:'Сервис временно недоступен'})[code]||'Не удалось выполнить запрос';
 const desc=({401:'Войдите в аккаунт, чтобы продолжить.',403:'У вас нет доступа к этой странице.',404:'Проверьте адрес страницы.',429:'Попробуйте повторить запрос позже.',500:'Произошла ошибка. Повторите попытку позже.',503:'Сервис временно недоступен. Повторите попытку позже.'})[code]||'Попробуйте повторить запрос позже.';
 document.querySelector('main').innerHTML='<section class="platform-error-page" role="alert"><div class="platform-error-copy"><p class="platform-error-kicker">Код ошибки: '+esc(code)+'</p><h1>'+esc(label)+'</h1><p>'+esc(desc)+'</p></div><div class="platform-error-code" aria-hidden="true">'+esc(code)+'</div></section>';}
}
addEventListener('pageshow',e=>{if(e.persisted&&!isPreview)location.reload();});
addEventListener('visibilitychange',async()=>{if(document.hidden||isPreview||!account)return;try{await api.resume();}catch(e){document.querySelector('#page-content')?.replaceChildren();showError(e.message);}});
void start();
