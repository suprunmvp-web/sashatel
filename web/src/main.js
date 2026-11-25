import {renderAccountPage, wireProfileEditor} from './cabinet-account.js';
import {wireStatisticsChart} from './cabinet-statistics-chart.js';
import {wireRecordingPlayer} from './cabinet-recording.js';
import {renderSettingsTabs, settingsUsersMarkup, clientInviteFields, wireClientInvite} from './cabinet-settings.js';
import {billingMarkup, invoiceFields, invoiceMethod, invoiceIcon, wireInvoiceForm} from './cabinet-billing.js';
import {renderPeriod, renderStatistics, renderCallFilters, renderCallDetails, renderPeoplePicker, wirePeoplePickers, wireCallHistory, wirePeriod} from './cabinet-reporting.js';
import {showTrunkDialog, trunkManagementMarkup, renderTrunkInformation, renderTrunkNumbers, wireTrunkNumbers, trunkLandingMarkup, renderTrunkHeader} from './trunk-dialog.js';
import {api,isPreview} from './session.js';
import {cabinetNavigation, cabinetWorkspace, cabinetProfile, cabinetFinance, verificationNotice, showCabinetWelcome, internalRoleLabels} from './cabinet-shell.js';
import {notify} from './notifications.js';
import {esc,icon,link,button,table,empty,missing,tabs,metrics,hydrate} from './components.js';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const query=new URLSearchParams(location.search),previewSuffix=isPreview?'?preview=1'+(query.get('role')?'&role='+encodeURIComponent(query.get('role')):''):'';
let parts=location.pathname.split('/').filter(Boolean);const admin=parts[0]==='admin';
let account=null,org=null,organizations=[],internalOrganizations=[],internalRole=isPreview?(query.get('role')||'reviewer'):null;
if(!Object.hasOwn(internalRoleLabels,internalRole))internalRole=null;
let canCreateInternalOrganization=false;
let internalCapabilities=[], internalManagers=[], internalContext=null, internalContextConflict=null;
const internalOrganizationPath='/admin/organizations/';
const isInternalOrganizationPath=pathname=>pathname.startsWith(internalOrganizationPath);
const canOpenInternalOrganization=()=>['owner','admin'].includes(internalRole)&&internalCapabilities.includes('client_context:read');
let page=admin?(parts[1]||'overview'):(parts[1]||'statistics'),service=isPreview&&query.get('service')==='1';
const nav=admin?[['overview','layout-dashboard','Обзор'],['employees','users','Сотрудники']]:[['statistics','chart-no-axes-column','Статистика'],['trunks','list-trunks','Транки'],['history','history','История звонков'],['integrations','plug','Интеграции'],['billing','credit-card','Биллинг'],['organization','settings','Настройки'],['support','message-circle','Поддержка'],['documentation','book-open','Документация']];
let collapsed=false, stopRecording;
try{collapsed=localStorage.getItem('sashatel.web.sidebar')==='collapsed';}catch{}
const base=()=>admin?'/admin/':'/'+org.id+'/';
const url=section=>base()+(section==='overview'||section==='statistics'?'':section+'/')+previewSuffix;
const currentNav=()=>!admin&&page==='employees'?'organization':page;
const title=()=>admin&&page==='organizations'?'Организация':nav.find(n=>n[0]===currentNav())?.[2]||({profile:'Мой профиль',security:'Безопасность',organization:'Организация'}[page]||'Страница не найдена');
function clientPage(){
 if(page==='statistics')return renderStatistics();
 if(page==='history'){
  if(parts[2])return renderCallDetails(url('history'),esc(base()+'history/'+encodeURIComponent(parts[2])+'/'),parts[3]);
  return renderCallFilters(base()+'history/',[],previewSuffix);
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
 if(page==='profile'||page==='security')return renderAccountPage(page,account,url);
 if(page==='organization')return renderSettingsTabs(false)+'<section id="settingsGeneral" class="requisites-panel settings-panel" role="tabpanel" aria-labelledby="settingsGeneralTab"><h2>Настройки организации</h2>'+
  '<form id="wsOrgForm" class="ws-form"><label>Название организации<input type="text" id="wsOrgName" name="legal_name" maxlength="180" required value="'+esc(org.legal_name)+'"></label>'+
  '<label>ИНН<input id="wsOrgInn" type="text" inputmode="numeric" readonly value="'+esc(org.inn)+'"></label>'+
  '<div class="ws-form-actions"><button id="wsOrgSave" type="submit" class="button" disabled>Сохранить настройки</button><button id="wsOrgCancel" type="button" class="button secondary" hidden>Отмена</button><span id="wsOrgFeedback" role="status"></span></div></form></section>';
 return empty('Страница не найдена','Выберите раздел в меню.');
}
const adminMinus='<svg class="cabinet-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9 12h6"/></svg>';
const adminMenuIcon=path=>'<svg class="cabinet-icon" viewBox="0 0 24 24" aria-hidden="true">'+path+'</svg>';
function organizationActions(organization){
 const id=esc(organization.id);
 const menuId='org-actions-'+id;
 const isAdministrator=['owner','admin'].includes(internalRole);
 const state=organization.verification_status;
 const button=(label,path)=>'<button type="button" disabled>'+adminMenuIcon(path)+label+'</button>';
 const finance=isAdministrator?
   button('Пополнить баланс','<path d="M12 5v14M5 12h14"/>')+
   button('Списать с баланса','<path d="M5 12h14"/>')+
   button('Дата следующей оплаты','<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/>')+
   '<p class="admin-org-menu-note">Операции с балансом и датой оплаты пока недоступны.</p>' : '';
 const reviewButton=(action,label,glyph)=>'<button type="button" data-review-org="'+id+'" data-review-action="'+action+'">'+icon(glyph)+label+'</button>';
 let verification='';
 if(state==='unverified'&&['owner','admin','reviewer'].includes(internalRole)){
  verification=reviewButton('review','Верифицировать организацию','circle-check');
 }else if(state==='rejected'&&internalCapabilities.includes('organizations:reopen')){
  verification=reviewButton('reopen','Вернуть на проверку','circle-check');
 }else if(state==='verified'&&isAdministrator){
  verification=button('Снять верификацию','<path d="M9 10V7a3 3 0 0 1 5.7-1.3M4 10h16v11H4zM12 14v3"/>')+
    '<p class="admin-org-menu-note">Снятие верификации пока недоступно.</p>';
 }
 if(!finance&&!verification)return '';
 const label='Действия организации '+esc(organization.display_name||organization.legal_name);
 return '<button type="button" class="icon-button admin-org-action-trigger" popovertarget="'+menuId+'" aria-label="'+label+'">'+icon('ellipsis')+'</button>'+
  '<div popover class="admin-org-action-menu" id="'+menuId+'" aria-label="'+label+'">'+finance+
  (finance&&verification?'<hr>':'')+verification+'</div>';
}

function organizationManager(organization){
 if(!['owner','admin'].includes(internalRole))return '<span class="cabinet-muted">Не назначен</span>';
 return renderPeoplePicker('org-manager-'+esc(organization.id),{
  label:'Не назначен',searchLabel:'Поиск менеджера',
  dialogLabel:'Ответственный менеджер: '+(organization.display_name||organization.legal_name),
  items:internalManagers,unavailable:'Сохранение назначения пока недоступно.',
 });
}

function internalOrganizationPage(){
 const back='<a href="/admin/" class="button secondary">К списку организаций</a>';
 if(!internalContext){
  const details=internalContextConflict?
   '<h2>Уже открыта другая организация</h2><p>При переключении текущий служебный доступ закроется.</p>'+
   '<button type="button" class="button" data-switch-internal-context>Открыть эту организацию</button>'
   :'<h2>Служебный доступ закрыт</h2><p>Откройте карточку заново из списка организаций.</p>';
  return '<section class="requisites-panel internal-organization">'+back+details+'</section>';
 }
 const item=internalContext.organization;
 const status={unverified:'Не верифицирована',verified:'Верифицирована',rejected:'Верификация отклонена'};
 return '<section class="requisites-panel internal-organization" aria-labelledby="internal-organization-heading">'+
   back+
   '<p class="cabinet-muted">Служебный доступ · Только чтение</p>'+
   '<h2 id="internal-organization-heading">'+esc(item.display_name||item.legal_name)+'</h2>'+
   '<dl class="account-details"><div><dt>Юридическое наименование</dt><dd>'+esc(item.legal_name)+'</dd></div>'+
   '<div><dt>ИНН</dt><dd>'+esc(item.inn)+'</dd></div>'+
   '<div><dt>Верификация</dt><dd>'+esc(status[item.verification_status]||'—')+'</dd></div></dl></section>';
}

const internalRoles=[
 ['reviewer','Проверяющий','Проверка организаций, фиксация решения и основания'],
 ['admin','Администратор','Внутренний администратор SashaTel']
];
function internalRoleChoices(name,selected){
 return '<fieldset class="ux-role-choices"><legend>Внутренняя роль</legend>'+
  internalRoles.map(([value,label,hint])=>'<label class="ux-role-choice"><input type="radio" name="'+name+
   '" value="'+value+'"'+(selected===value?' checked':'')+'><span class="ux-role-radio" aria-hidden="true"></span>'+
   '<span class="ux-role-copy"><strong>'+label+'</strong><small>'+hint+'</small></span></label>').join('')+'</fieldset>';
}
function staffActions(){
 return '<button type="button" popovertarget="adminStaffMenu" class="icon-button admin-org-action-trigger" aria-label="Действия сотрудника">'+icon('ellipsis')+'</button>'+
  '<div popover id="adminStaffMenu" class="admin-org-action-menu" aria-label="Действия сотрудника">'+
  '<button type="button" data-staff-action="internal-role">'+adminMenuIcon('<path d="M12 20h9M16 3l5 5L9 20H4v-5L16 3Z"/>')+'Изменить роль</button>'+
  '<button type="button" data-staff-action="internal-contacts">'+adminMenuIcon('<circle cx="12" cy="8" r="3"/><path d="M5 20v-1a7 7 0 0 1 14 0v1"/>')+'Контакты и Telegram</button>'+
  '<button type="button" disabled>'+adminMenuIcon('<path d="M4 7h16M10 4h4m-8 3 1 13h10l1-13"/>')+'Отозвать доступ</button></div>';
}
function adminPage(){
 if(!Object.hasOwn(internalRoleLabels,internalRole))return empty('Служебный доступ запрещён','Доступ к организациям есть только у сотрудников SashaTel с подтверждёнными сервером полномочиями.',true);
 if(page==='organizations')return internalOrganizationPage();
 if(page==='profile'||page==='security')return renderAccountPage(page,account,url);
 if(page==='employees'){
  const fullName=[account.last_name,account.first_name].filter(Boolean).join(' ')||'—';
  const emailStatus=account.email_verified===true
   ? '<span class="admin-verification" data-verified="true">'+icon('circle-check')+'Да</span>'
   : account.email_verified===false?'<span class="admin-verification">'+adminMinus+'Нет</span>':'—';
  const roleName=internalRoleLabels[internalRole];
  const role=internalRole==='admin'?'<button class="admin-staff-role" type="button" data-action="internal-role">'+roleName+icon('chevron-down')+'</button>':roleName;
  const row=['<strong>'+esc(fullName)+'</strong>',esc(account.email||'—'),role,esc(account.phone||'—'),emailStatus,'—',internalRole==='admin'?staffActions():''];
  return '<section class="admin-staff"><div class="section-heading ux-staff-header"><span id="adminStaffCount" role="status">1 из 1</span>'+
   '<label class="workspace-search">'+icon('search')+'<input id="adminStaffSearch" type="search" placeholder="Поиск сотрудника" aria-label="Поиск сотрудников"></label></div>'+
   table(['Фамилия Имя','Email','Роль','Телефон','Email подтверждён','Дата регистрации',''],[row])+'</section>';
 }
 if(page!=='overview')return empty('Страница не найдена','Выберите раздел в меню.');
 const filter='<label class="workspace-search admin-org-search">'+icon('search')+'<input type="search" id="organization-filter" aria-label="Поиск организации" placeholder="Название или ИНН"></label>';
 const labels={unverified:'Нет',verified:'Да',rejected:'Отклонена'};
 const membershipIds=new Set(organizations.map(item=>item.id));
 const managerFilter='<div class="admin-manager-filter"><span>Ответственный</span>'+
  '<button type="button" id="orgManagerFilter" class="calls-filter-btn" disabled title="Фильтр требует серверных назначений">Все менеджеры</button></div>';
 const rows=internalOrganizations.map(o=>{
  const name=esc(o.display_name||o.legal_name||'Без названия');
  const href='/'+encodeURIComponent(o.id)+'/'+esc(previewSuffix);
  const organizationLink=canOpenInternalOrganization()
   ? '<a class="admin-org-link" href="'+internalOrganizationPath+encodeURIComponent(o.id)+'/">'+name+'</a>'
   : membershipIds.has(o.id)
    ? '<a class="admin-org-link" data-open-org="'+esc(o.id)+'" href="'+href+'">'+name+'</a>'
    : '<strong>'+name+'</strong>';
  return [
  organizationLink,
  '<span class="mono">'+esc(o.inn||'—')+'</span>',
  '<span class="admin-verification" data-verified="'+String(o.verification_status==='verified')+'">'+(o.verification_status==='verified'?icon('circle-check'):adminMinus)+esc(labels[o.verification_status]||'—')+'</span>',
  organizationManager(o),
  '—',
  organizationActions(o)
 ];});
 const total=new Intl.NumberFormat('ru-RU').format(internalOrganizations.length);
 const kpis=[
  ['Организации',total,'В полученном списке'],
  ['Потрачено минут','—','За выбранный период'],
  ['Выручка фактическая','—','Подтверждённые оплаты']
 ];
 const analytics='<section class="cabinet-admin-analytics" aria-labelledby="admin-analytics-title"><div class="section-heading"><h2 id="admin-analytics-title">Показатели платформы</h2>'+renderPeriod()+'</div>'+
  '<dl class="admin-metrics">'+kpis.map(([label,value,description])=>'<div><dt>'+label+'</dt><dd>'+value+'</dd><dd class="admin-metric-description">'+description+'</dd></div>').join('')+'</dl>'+
  '<div class="admin-chart-heading"><h3>Тарифицируемые минуты по дням</h3><span><i aria-hidden="true"></i>Минуты</span></div>'+
  '<div class="cabinet-admin-chart" role="img" aria-label="Нет данных по минутам"></div></section>';
 return analytics+'<section class="cabinet-admin-organizations"><div class="section-heading"><h2>Организации</h2><span id="adminOrgTotal" aria-hidden="true"></span></div><div class="admin-org-toolbar">'+managerFilter+filter+'</div>'+
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
 stopRecording?.();
 document.body.className='platform'+(collapsed?' sidebar-collapsed':'');
 document.documentElement.dataset.theme=savedTheme();
 const heading=esc(title());
 const content=admin?adminPage():org.role==='employee'&&page!=='profile'&&page!=='security'
  ?empty('Кабинет организации','Управление доступно Владельцу и Администратору. Звонки — в Desktop.')
  :clientPage();
 document.body.innerHTML='<a class="skip" href="#content">К содержанию</a><aside class="sidebar" id="cabinet-sidebar">'+
  '<button type="button" class="icon-button drawer-close" data-action="close-drawer" aria-label="Закрыть меню">'+icon('x')+'</button>'+
  cabinetWorkspace({admin,org,organizations})+(admin&&canCreateInternalOrganization?'<button class="button admin-create-client" type="button" data-action="client" aria-label="Создать клиента"><svg class="cabinet-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span>Создать клиента</span></button>':'')+cabinetNavigation({admin,nav,current:currentNav(),url})+(admin?'':cabinetFinance())+cabinetProfile({account,org,url,internalRole:admin?internalRole:null})+'</aside>'+
  '<button type="button" class="drawer-scrim" data-action="close-drawer" aria-label="Закрыть меню" tabindex="-1" hidden></button>'+
  '<div class="platform-body"><header class="platform-top"><div class="platform-heading">'+
  '<button type="button" class="icon-button" data-action="sidebar" aria-label="Меню кабинета" aria-controls="cabinet-sidebar" aria-expanded="'+(!collapsed&&!matchMedia('(max-width:768px)').matches)+'"><svg class="cabinet-icon" viewBox="0 0 24 24" aria-hidden="true"><rect height="16" rx="2" width="18" x="3" y="4"/><path d="M9 4v16"/></svg></button>'+
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
 if(admin)return segments[0]==='admin'&&!isInternalOrganizationPath(pathname);
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
 if(internalContext){location.reload();return;}
 if(cabinetPath(location.pathname))navigate(location.pathname);
 else location.reload();
});
function savedTheme(){try{return localStorage.getItem('sashatel.web.theme')==='light'?'light':'dark';}catch{return 'dark';}}
function operation(action,organization){
 const dialog=document.querySelector('#operation-dialog');
 const trunkKind={trunk:'create','trunk-sip':'sip','trunk-rename':'rename'}[action];
 if(trunkKind){
  showTrunkDialog(dialog,trunkKind,()=>showError('Не удалось выполнить действие. Попробуйте ещё раз.'));
  return;
 }
 let name='',fields='',submit='Подтвердить';
 let description=organization?.legal_name||'';
 if(action==='internal-invite'){
  name='Добавить сотрудника';submit='Добавить';
  fields=`<div class="admin-dialog-form"><label>Фамилия Имя<input id="uxStaffName" type="text" required placeholder="Имя и фамилия"/></label><label>Email<input id="uxStaffEmail" type="email" required placeholder="name@sashatel.example"/></label><label>Телефон<input id="uxStaffPhone" type="tel" placeholder="+7 ..."/></label><label>Имя пользователя в Telegram<input id="uxStaffTelegram" maxlength="33" placeholder="@username"/></label></div>`+
   internalRoleChoices('uxStaffRole','reviewer');
 }
 const staffDialog=action==='internal-role'||action==='internal-contacts';
 if(staffDialog){
  if(internalRole!=='admin')return;
  description=[[account.first_name,account.last_name].filter(Boolean).join(' '),account.email].filter(Boolean).join(' · ');
  name=action==='internal-role'?'Изменить роль':'Контакты сотрудника';
  submit='Сохранить';
  fields=action==='internal-role'?internalRoleChoices('uxRole',internalRole):
   '<div class="admin-dialog-form"><label>Телефон<input id="staffContactPhone" type="tel" placeholder="+7 900 123 45 67" value="'+esc(account.phone||'')+'"></label>'+
   '<label>Имя пользователя в Telegram<input id="staffContactTelegram" type="text" autocomplete="off" maxlength="33" placeholder="@username"></label></div>';
 }
 if(action==='invite'){
  name='Пригласить сотрудника';
  submit='Добавить пользователя';
  fields=clientInviteFields;
 }
 if(action==='integration'){name='Создать интеграцию';fields='<label>Тип<select><option>amoCRM</option><option>Битрикс24</option><option>Webhook/API</option></select></label>';}
 if(action==='invoice'){name='Пополнение по счёту';submit='Сформировать счёт';fields=invoiceFields;}
 if(action==='client'){
  if(!admin||!canCreateInternalOrganization)return;
  name='Создать клиента';submit='Создать клиента';
  fields='<div class="admin-dialog-form">'+
   '<label>ИНН<input name="inn" inputmode="numeric" pattern="[0-9]{10}|[0-9]{12}" maxlength="12" placeholder="10 или 12 цифр" required autofocus></label>'+
   '<label>Название в кабинете<input name="display_name" maxlength="180" placeholder="ООО «Название»" required></label>'+
   '<p class="cabinet-muted">Юридические реквизиты заполним по ИНН.</p><p class="error" role="alert" hidden></p></div>';
 }
 if(!name)return;
 const trigger=document.activeElement;
 const context=description?'<p class="cabinet-muted">'+esc(description)+'</p>':'';
 const heading='<h2 id="dialog-title">'+esc(name)+'</h2>';
 dialog.innerHTML='<form method="dialog"'+(staffDialog?' class="staff-edit-form"':'')+'><header>'+
  (staffDialog?'<div class="staff-dialog-heading">'+heading+context+'</div>':heading)+
  '<button class="icon-button" formnovalidate value="cancel" aria-label="Закрыть">'+icon('x')+'</button></header>'+
  (staffDialog?'':context)+'<div class="dialog-fields">'+fields+'</div>'+
  (action==='invoice'?invoiceMethod:'')+'<footer class="dialog-actions"><button class="button secondary" formnovalidate value="cancel">Отмена</button><button class="button" value="submit">'+esc(submit)+'</button></footer></form>';
 const form=dialog.querySelector('form');
 const validInvoice=action==='invoice'?wireInvoiceForm(form,org?.inn):null;
 form.onsubmit=async event=>{
  if(event.submitter?.value!=='submit')return;
  event.preventDefault();
  if(action==='client'){await submitInternalOrganization(dialog,form,event.submitter);return;}
  if(validInvoice&&!validInvoice())return;
  showError(action==='invoice'?'Не удалось сформировать счёт. Попробуйте ещё раз.':'Не удалось выполнить действие. Попробуйте ещё раз.');
 };
 hydrate(dialog);dialog.showModal();
 dialog.querySelector('[name=secret]')?.setAttribute('autocomplete','new-password');
 if(action==='invite')wireClientInvite(form);

 dialog.onclose=()=>{if(dialog.open)return;dialog.querySelectorAll('input').forEach(el=>{el.value='';});dialog.replaceChildren();if(document.activeElement===document.body)trigger?.focus({preventScroll:true});};
}
async function submitInternalOrganization(dialog,form,submit){
 const error=form.querySelector('[role=alert]');
 const data=new FormData(form);
 const inn=String(data.get('inn')).trim(),display_name=String(data.get('display_name')).trim();
 error.hidden=true;
 const controls=Array.from(form.elements).filter(control=>!control.disabled);
 controls.forEach(control=>{control.disabled=true;});
 dialog.oncancel=event=>event.preventDefault();
 form.setAttribute('aria-busy','true');
 submit.textContent='Создаём…';
 let created;
 try{
  created=(await api.createInternalOrganization({inn,display_name})).organization;
 }catch(e){
  error.textContent=e.message||'Не удалось создать организацию.';
  error.hidden=false;
  return;
 }finally{
  controls.forEach(control=>{control.disabled=false;});
  dialog.oncancel=null;
  form.removeAttribute('aria-busy');
  submit.textContent='Создать клиента';
 }
 internalOrganizations=[created,...internalOrganizations.filter(item=>item.id!==created.id)];
 dialog.close();
 if(location.pathname!=='/admin/')history.pushState(null,'','/admin/');
 navigate(location.pathname);
 notify('Клиент создан','success');
}
function reviewOrganizationDialog(id,action,trigger){
 const organization=internalOrganizations.find(o=>o.id===id);
 const reopen=action==='reopen';
 if(!organization||organization.verification_status!==(reopen?'rejected':'unverified'))return;
 const dialog=document.querySelector('#operation-dialog');
 dialog.innerHTML='<form id="internal-review-form"><header><h2 id="dialog-title">'+
    (reopen?'Вернуть организацию на проверку':'Верифицировать организацию')+'</h2>'+
    '<button type="button" class="icon-button" data-review-close aria-label="Закрыть">'+icon('x')+'</button></header>'+
    '<p><strong>'+esc(organization.legal_name)+'</strong> · ИНН '+esc(organization.inn)+'</p>'+
    '<div class="dialog-fields"><label>Проверенные документы / основание<input name="evidence" maxlength="500" minlength="5" required></label>'+
    '<label>Комментарий проверки<textarea name="explanation" minlength="8" maxlength="2000" required></textarea></label></div>'+
    (reopen?'':'<p class="warning">Подтверждение закрепляет ИНН за организацией. При отказе телефония останется недоступна.</p>')+
    '<footer class="dialog-actions"><button class="button" type="submit" value="verified">'+(reopen?'Вернуть на проверку':'Подтвердить верификацию')+'</button>'+
    (reopen?'':'<button class="button secondary" type="submit" value="rejected">Отклонить верификацию</button>')+'</footer></form>';
 hydrate(dialog);
 dialog.querySelector('[data-review-close]').onclick=()=>dialog.close();
 dialog.querySelector('form').onsubmit=async(event)=>{
   event.preventDefault();
   const form=event.currentTarget;
   const controls=[...form.querySelectorAll('[type="submit"]')];
   if(controls.some(button=>button.disabled)||!form.reportValidity())return;
   controls.forEach(button=>{button.disabled=true;});
   let result;
   try{
     const evidence=form.elements.evidence.value.trim();
     const explanation=form.elements.explanation.value.trim();
     result=reopen?await api.reopenOrganization(id,evidence,explanation)
      :await api.reviewOrganization(id,event.submitter?.value==='rejected'?'rejected':'verified',evidence,explanation);
   }catch(error){
     if(['ALREADY_REVIEWED','REOPEN_REQUIRES_REJECTED'].includes(error.code)){
       try{
         internalOrganizations=await api.internalOrganizations();
         if(form.isConnected&&dialog.open)dialog.close();
         if(!dialog.open)render();
       }catch{controls.forEach(button=>{button.disabled=false;});}
     }else{
       controls.forEach(button=>{button.disabled=false;});
     }
     showError(error.message||'Не удалось провести проверку.');
     return;
   }
   internalOrganizations=internalOrganizations.map(item=>item.id===id
     ?{...item,verification_status:result.verification_status}:item);
   if(form.isConnected&&dialog.open)dialog.close();
   if(!dialog.open)render();
   notify(({verified:'Организация верифицирована',rejected:'Верификация отклонена',unverified:'Организация возвращена на проверку'})[result.verification_status],'success');
 };
 dialog.onclose=()=>{if(dialog.open)return;dialog.replaceChildren();if(document.activeElement===document.body)trigger?.focus({preventScroll:true});};
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
 wireProfileEditor(document);
 const orgForm=document.querySelector('#wsOrgForm');
 if(orgForm){
  const name=orgForm.elements.legal_name;
  const submit=orgForm.querySelector('#wsOrgSave');
  const feedback=orgForm.querySelector('#wsOrgFeedback');
  const cancel=orgForm.querySelector('#wsOrgCancel');
  orgForm.oninput=()=>{
   cancel.hidden=name.value===name.defaultValue;
   submit.disabled=!name.value.trim()||name.value.trim()===org.legal_name;
   feedback.textContent='';
  };
  cancel.onclick=()=>{
   orgForm.reset();
   orgForm.oninput();
   name.focus();
  };
  orgForm.onsubmit=event=>{
   event.preventDefault();
   if(submit.disabled)return;
   feedback.textContent='Не удалось сохранить название.';
  };
 }
 wireWorkspacePicker();
 wirePeriod(document);
 wireStatisticsChart(document);
 wirePeoplePickers(document);
 stopRecording=wireRecordingPlayer(document.querySelector('#page-content'));
 const copyContact=document.querySelector('#callCopyJson');
 if(copyContact)copyContact.onclick=async()=>{
  const status=document.querySelector('#callJsonStatus');
  try{await navigator.clipboard.writeText(document.querySelector('#callContactJson').textContent);status.textContent='JSON скопирован';}
  catch{status.textContent='Не удалось скопировать JSON.';}
 };
 wireTrunkNumbers(document);
 wireCallHistory(document);
 document.querySelectorAll('[data-action]').forEach(el=>el.onclick=async()=>{
 const action=el.dataset.action;
 if(action==='close-drawer'){setDrawer(false);return;}
 if(action==='sidebar'&&matchMedia('(max-width:768px)').matches){setDrawer(true);return;}
 if(action==='sidebar'){collapsed=!collapsed;try{localStorage.setItem('sashatel.web.sidebar',collapsed?'collapsed':'expanded');}catch{}document.body.classList.toggle('sidebar-collapsed',collapsed);el.setAttribute('aria-expanded',String(!collapsed));return;}
 if(action==='theme'){const value=savedTheme()==='dark'?'light':'dark';try{localStorage.setItem('sashatel.web.theme',value);}catch{}document.documentElement.dataset.theme=value;el.innerHTML=icon(value==='dark'?'sun':'moon');hydrate(el);return;}
 if(action==='logout'){el.disabled=true;try{await api.logout();location.assign('/login/');}catch(e){el.disabled=false;showError(e.message);}return;}
 operation(action);
 });
 const closeOrganizationMenu=button=>{
  const menu=button.closest('[popover]');
  const trigger=menu.previousElementSibling;
  menu.hidePopover();
  trigger.focus({preventScroll:true});
  return trigger;
 };
 document.querySelectorAll('[data-staff-action]').forEach(el=>el.onclick=()=>{
  closeOrganizationMenu(el);
  operation(el.dataset.staffAction);
 });
 document.querySelectorAll('[data-review-org]').forEach(el=>el.onclick=()=>{
  reviewOrganizationDialog(el.dataset.reviewOrg,el.dataset.reviewAction,closeOrganizationMenu(el));
 });
 const switchContext=document.querySelector('[data-switch-internal-context]');
 if(switchContext)switchContext.onclick=async()=>{
  switchContext.disabled=true;
  try{
   await api.closeInternalClientContext(internalContextConflict.id);
   internalContextConflict=null;
   internalContext=await api.openInternalClientContext(parts[2]);
   render();
  }catch(error){
   if(!internalContextConflict)render();
   else switchContext.disabled=false;
   showError(error.message);
  }
 };
 if(internalContext){
  document.querySelectorAll('a[href^="/admin/"]').forEach(link=>link.onclick=async event=>{
   if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
   event.preventDefault();
   if(link.getAttribute('aria-busy')==='true')return;
   link.setAttribute('aria-busy','true');
   try{
    await api.closeInternalClientContext(internalContext.id);
    location.assign(link.href);
   }catch(error){
    showError(error.message);
    link.removeAttribute('aria-busy');
   }
  });
 }
 wireAdminOrganizationList();
 const staffSearch=document.querySelector('#adminStaffSearch');
 if(staffSearch)staffSearch.oninput=()=>{
  const row=document.querySelector('.admin-staff tbody tr');
  row.hidden=!row.textContent.toLocaleLowerCase('ru').includes(staffSearch.value.trim().toLocaleLowerCase('ru'));
  document.querySelector('#adminStaffCount').textContent=(row.hidden?'0':'1')+' из 1';
 };
}
function wireAdminOrganizationList(){
 const section=document.querySelector('.cabinet-admin-organizations');
 if(!section)return;
 const search=section.querySelector('#organization-filter');
 const tbody=section.querySelector('tbody');
 const pager=section.querySelector('.admin-org-pager');
 const [previous,next]=pager.querySelectorAll('button');
 const count=section.querySelector('#adminOrgTotal');
 const rows=[...tbody.rows].filter(row=>!row.querySelector('.table-empty'));
 const noResults=tbody.insertRow();
 const noResultsCell=noResults.insertCell();
 noResultsCell.className='table-empty';
 noResultsCell.colSpan=6;
 noResultsCell.textContent='Организации не найдены';
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
  const matches=rows.filter(row=>[row.cells[0],row.cells[1]].some(cell=>cell.textContent.toLocaleLowerCase('ru').includes(query)));
  if(sortColumn>=0)matches.sort((a,b)=>collator.compare(a.cells[sortColumn].textContent,b.cells[sortColumn].textContent)*(ascending?1:-1));
  for(const row of rows)row.hidden=true;
  const start=current*pageSize;
  for(const row of matches.slice(start,start+pageSize)){row.hidden=false;tbody.append(row);}
  pager.querySelector('[role=status]').textContent=matches.length?`${start+1}–${Math.min(start+pageSize,matches.length)} из ${matches.length}`:'Организации не найдены';
  noResults.hidden=matches.length>0||rows.length===0;
  count.textContent=matches.length+' из '+rows.length;
  previous.disabled=current===0;
  next.disabled=(current+1)*pageSize>=matches.length;
 }
 for(const index of [0,1,2]){
  const header=columns[index],control=document.createElement('button');
  control.type='button';
  control.className='org-sort';
  control.innerHTML=esc(header.textContent)+'<svg viewBox="0 0 16 16" aria-hidden="true"><path class="sort-up" d="m5 6 3-3 3 3"/><path class="sort-down" d="m5 10 3 3 3-3"/></svg>';
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
const httpErrorCopy = {
 400: ['Некорректный запрос', 'Проверьте введённые данные и повторите попытку.'],
 401: ['Войдите в аккаунт', 'Для этой страницы нужна активная сессия.'],
 402: ['Требуется оплата', 'Проверьте статус оплаты в личном кабинете.'],
 403: ['Доступ запрещён', 'Если вам нужен доступ, обратитесь к администратору.'],
 404: ['Страница не найдена', 'Проверьте адрес или откройте страницу через кабинет.'],
 405: ['Действие недоступно', 'Обновите страницу и попробуйте ещё раз.'],
 408: ['Время ожидания истекло', 'Повторите попытку.'],
 409: ['Данные изменились', 'Обновите страницу перед повторной попыткой.'],
 410: ['Страница больше недоступна', 'Откройте нужный раздел через кабинет.'],
 413: ['Запрос слишком большой', 'Уменьшите размер данных и повторите попытку.'],
 422: ['Запрос не принят', 'Проверьте введённые данные.'],
 429: ['Слишком много запросов', 'Подождите немного перед следующей попыткой.'],
 500: ['Ошибка на сервере', 'Повторите попытку позже.'],
 502: ['Нет ответа от сервиса', 'Повторите попытку позже.'],
 503: ['Сервис временно недоступен', 'Повторите попытку позже.'],
 504: ['Сервис не ответил вовремя', 'Повторите попытку позже.'],
};
function renderPlatformError(error){
 const status=Number(error?.status);
 const hasHttpError=Number.isInteger(status)&&status>=400&&status<=599;
 const [heading,description]=hasHttpError
  ? httpErrorCopy[status]??(status<500
   ? ['Запрос не выполнен', 'Обновите страницу и попробуйте ещё раз.']
   : ['Ошибка на сервере', 'Повторите попытку позже.'])
  : error?.code==='NETWORK_UNKNOWN'
   ? ['Не удалось связаться с сервисом', 'Проверьте подключение и повторите попытку.']
   : ['Не удалось загрузить страницу', 'Обновите страницу и попробуйте ещё раз.'];
 const main=document.querySelector('main');
 main.removeAttribute('aria-busy');
 document.title=heading+' — SashaTel';
 main.innerHTML='<section class="platform-error-page" role="alert"><div class="platform-error-copy"><h1>'+esc(heading)+'</h1><p>'+esc(description)+'</p></div>'+
  (hasHttpError?'<span class="platform-error-code" role="img" aria-label="Код ошибки '+status+'">'+status+'</span>':'')+'</section>';
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
      internalCapabilities=internal.capabilities??[];
      canCreateInternalOrganization=internalCapabilities.includes('organizations:create');
      if(isInternalOrganizationPath(location.pathname)){
       const organizationId=parts[2];
       if(parts.length!==3||!uuid.test(organizationId))throw {status:404};
       if(!canOpenInternalOrganization())throw {status:403};
       let current;
       try{current=await api.internalClientContext();}
       catch(error){if(error.status!==404)throw error;}
       if(current&&current.organization.id!==organizationId)internalContextConflict=current;
       else internalContext=current??await api.openInternalClientContext(organizationId);
       document.title='Организация — SashaTel';
      }else{
       internalOrganizations=await api.internalOrganizations();
       if(page==='overview'&&internalCapabilities.includes('staff:manage')){
        try{internalManagers=(await api.internalStaff()).filter(item=>item.active&&item.role==='manager').map(item=>item.email);}
        catch{internalManagers=[];}
       }
      }
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
 }catch(error){
  const lostSession=error?.status===401&&['ACCESS_EXPIRED','SESSION_REVOKED','REFRESH_EXPIRED','REFRESH_REUSED'].includes(error.code);
  if(!isPreview&&lostSession){
   if(location.pathname!=='/login/')history.replaceState(null,'','/login/');
   await import('./auth.js');
   return;
  }
  renderPlatformError(error);
 }
}
addEventListener('pageshow',e=>{if(e.persisted&&!isPreview)location.reload();});
addEventListener('visibilitychange',async()=>{
 if(document.hidden||isPreview||!account)return;
 try{
  await api.resume();
  if(internalContext&&(await api.internalClientContext()).id!==internalContext.id){
   internalContext=null;
   render();
  }
 }catch(e){
  if(internalContext){
   internalContext=null;
   render();
  }else document.querySelector('#page-content')?.replaceChildren();
  if(e.status!==404)showError(e.message);
 }
});
void start();
