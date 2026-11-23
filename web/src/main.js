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
const nav=admin?[['overview','layout-dashboard','Обзор'],['employees','users','Сотрудники']]:[['statistics','chart-no-axes-column','Статистика'],['trunks','list-trunks','Транки'],['history','history','История звонков'],['integrations','plug','Интеграции'],['billing','credit-card','Биллинг'],['organization','settings','Настройки']];
let collapsed=false;
try{collapsed=localStorage.getItem('sashatel.web.sidebar')==='collapsed';}catch{}
const base=()=>admin?'/admin/':'/'+org.id+'/';
const url=section=>base()+(section==='overview'||section==='statistics'?'':section+'/')+previewSuffix;
const currentNav=()=>!admin&&page==='employees'?'organization':page;
const title=()=>nav.find(n=>n[0]===currentNav())?.[2]||({profile:'Профиль',security:'Безопасность',organization:'Организация'}[page]||'Страница не найдена');
function settingsNavigation(){
 return '<nav class="tabs" aria-label="Настройки организации">'+link(url('organization'),'Общие',page==='organization')+link(url('employees'),'Пользователи',page==='employees')+'</nav>';
}
function accountPage(section){
 if(section==='profile')return '<dl class="summary">'+[['Имя',account.first_name],['Фамилия',account.last_name],['Email',account.email],['Телефон',account.phone]].map(([k,v])=>'<dt>'+k+'</dt><dd>'+esc(v??'Не указано')+'</dd>').join('')+'</dl><p class="hint">Телефон не подтверждён. Он не используется для входа и восстановления доступа.</p>';
 if(section==='security')return '<h2>Сессии и пароль</h2>'+link('/recovery/','Восстановить пароль')+button('Выйти из текущей сессии','logout');
}
function clientPage(){
 if(page==='statistics')return '<div class="statistics-page">'+
  '<dl class="metrics statistics-metrics">'+
  ['Потрачено минут','Попытки звонка','Ответы','Дозвон'].map(label=>'<div><dt>'+label+'</dt><dd aria-label="Нет данных">—</dd></div>').join('')+
  '</dl><section class="statistics-chart"><h2>Динамика дозвона</h2>'+
  '<div class="statistics-unavailable" role="status">'+icon('activity')+
  '<strong>Статистика пока недоступна</strong><p>Здесь появятся показатели после подключения данных о звонках.</p></div></section></div>';
 if(page==='history'){
  if(parts[2]){
   const sections=[['transcript','Транскрипция'],['details','О контакте'],['agreements','Договорённости']];
   const active=sections.some(([id])=>id===parts[3])?parts[3]:'transcript';
   return link(url('history'),'← К истории звонков')+tabs(sections,active,base()+'history/'+parts[2]+'/')+
    empty(sections.find(([id])=>id===active)[1],'Данные этой карточки сейчас недоступны.',true);
  }
  return table(['Дата и время','Сотрудник','Номер','Запись','Длительность','Результат'],[],'История звонков пока недоступна.');
 }
 if(page==='trunks'){
  if(parts[2])return '<a href="'+url('trunks')+'">К транкам</a>'+tabs([['management','Управление'],['information','Информация'],['numbers','Номера']],parts[3]||'management',base()+'trunks/'+parts[2]+'/')+(parts[3]==='numbers'?table(['Номер','Спам-метка','Инициации','Ответы','Дозвон'],[])+missing('номеров'):parts[3]==='information'?table(['Параметр','Значение'],['Регистрация SIP','Доступность','Ошибка','Сервер / порт','Транспорт','Авторизация','Endpoint / AOR'].map(k=>[k,'Нет данных'])): '<div class="warning">До верификации организации транк нельзя активировать.</div><div class="actions">'+button('Включить транк','activate',true)+button('Изменить SIP-данные','trunk-sip',false,true)+button('Удалить транк','delete',true,true)+'</div>'+missing('управления транком'));
  return table(['Название','Состояние','Действия'],[],'Список транков пока недоступен.');
 }
 if(page==='employees')return settingsNavigation()+'<section class="requisites-panel"><div class="section-heading"><h2>Пользователи организации</h2>'+
  button(icon('plus')+' Пригласить пользователя','invite')+'</div>'+
  table(['Пользователь','Email','Роль','Телефон','Email подтверждён','Дата регистрации','Действия'],[],'Список пользователей пока недоступен.')+'</section>';
 if(page==='integrations')return '<section class="integration-unavailable">'+'<span class="integration-lock" aria-hidden="true"><img src="/assets/lock.svg" width="34" height="34" alt=""></span>'+'<p>Данный раздел находится в разработке. Мы вам сообщим, когда он появится. Благодарим за ожидание!</p></section>';
 if(page==='billing')return metrics(['Текущий расход','Оплатить до','Счетов в списке'])+
  '<h2>Счета и документы</h2>'+table(['Номер','Период','Сумма','Статус','Документ'],[],'Список счетов пока недоступен.');
 if(page==='profile'||page==='security')return accountPage(page);
 if(page==='organization')return settingsNavigation()+'<section class="requisites-panel"><h2>Настройки организации</h2>'+
  '<div class="dialog-fields"><label>Название организации<input readonly value="'+esc(org.legal_name)+'"></label>'+
  '<label>ИНН<input readonly value="'+esc(org.inn)+'"></label></div>'+
  ''+button('Сохранить настройки','requisites',true)+'</section>';
 return empty('Страница не найдена','Выберите раздел в меню.');
}
function adminPage(){
 if(!internalRole)return empty('Служебный доступ запрещён','Доступ к организациям есть только у сотрудников SashaTel с подтверждёнными сервером полномочиями.',true);
 if(page==='profile'||page==='security')return accountPage(page);
 if(page==='employees')return missing('реестра внутренних сотрудников');
 if(page!=='overview')return empty('Страница не найдена','Выберите раздел в меню.');
 const filter='<label class="workspace-search admin-org-search">'+icon('search')+'<input type="search" id="organization-filter" aria-label="Поиск организации" placeholder="Название или ИНН"></label>';
 const labels={unverified:'Ожидает проверки',verified:'Верифицирована',rejected:'Отклонена'};
 const rows=internalOrganizations.map(o=>[
  '<strong>'+esc(o.legal_name||'Без названия')+'</strong>',
  '<span class="mono">'+esc(o.inn||'—')+'</span>',
  esc(o.created_owner_email||'—'),
  esc(labels[o.verification_status]||'Неизвестно'),
  o.verification_status==='unverified'
   ? '<button type="button" class="button secondary" data-review-org="'+esc(o.id)+'" data-review-decision="verified">Подтвердить</button> <button type="button" class="button secondary" data-review-org="'+esc(o.id)+'" data-review-decision="rejected">Отклонить</button>'
   : '—'
 ]);
 const analytics='<section class="cabinet-admin-analytics" aria-labelledby="admin-analytics-title"><h2 id="admin-analytics-title">Показатели платформы</h2>'+
  '<dl class="metrics"><div><dt>Организации</dt><dd>'+new Intl.NumberFormat('ru-RU').format(internalOrganizations.length)+'</dd></div>'+
  '<div><dt>Потрачено минут</dt><dd>—</dd></div><div><dt>Выручка фактическая</dt><dd>—</dd></div></dl>'+
  '<h3>Тарифицируемые минуты по дням</h3><div class="cabinet-admin-chart" aria-label="Нет данных по минутам"></div></section>';
 return analytics+'<section class="cabinet-admin-organizations"><div class="section-heading"><h2>Организации</h2>'+filter+'</div>'+
   table(['Организация','ИНН','Владелец','Верификация','Действия'],rows,'Организаций нет')+'</section>';
}
function pageAction(){
 if(admin)return internalRole==='admin'&&page==='overview'?button(icon('plus')+' Создать клиента','client'):'';
 if(org.role==='employee'||parts[2])return '';
 if(page==='trunks')return button(icon('plus')+' Создать транк','trunk');
 if(page==='billing')return button('Пополнение по счёту','invoice');
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
  cabinetWorkspace({admin,org,organizations})+cabinetNavigation({admin,nav,current:currentNav(),url})+(admin?'':cabinetFinance())+cabinetProfile({account,org,url,internalRole:admin?internalRole:null})+'</aside>'+
  '<button type="button" class="drawer-scrim" data-action="close-drawer" aria-label="Закрыть меню" tabindex="-1" hidden></button>'+
  '<div class="platform-body"><header class="platform-top"><div class="platform-heading">'+
  '<button type="button" class="icon-button" data-action="sidebar" aria-label="Меню кабинета" aria-controls="cabinet-sidebar" aria-expanded="'+(!collapsed&&!matchMedia('(max-width:768px)').matches)+'">'+icon('panel-left')+'</button>'+
  '<span class="platform-crumb">SashaTel</span>'+icon('chevron-right')+'<strong>'+heading+'</strong></div>'+
  '<div class="top-controls">'+(isPreview?'<span class="fixture-badge">Preview · fixture</span>':'')+
  '<button type="button" class="icon-button" data-action="theme" aria-label="Переключить тему">'+icon(savedTheme()==='dark'?'sun':'moon')+'</button></div></header>'+
  (service?'<div class="service-banner">Служебный доступ · '+esc(account.first_name+' '+account.last_name)+' · '+link('/admin/?preview=1','Вернуться в обзор')+'</div>':'')+
  '<main id="content" tabindex="-1">'+(!admin?verificationNotice(org.verification_status):'')+
  '<div class="page-heading"><h1 tabindex="-1">'+heading+'</h1>'+pageAction()+'</div><div id="page-content">'+content+'</div>'+
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
 const dialog=document.querySelector('dialog');
 let name='',fields='',warning='',submit='Подтвердить';
 const field=(label,name,type='text')=>'<label>'+label+'<input name="'+name+'" type="'+type+'" required></label>';
 if(action==='trunk'){
  name='Создать транк';
  submit='Создать транк';
  fields='<label class="trunk-name-field">Название транка<input name="name" placeholder="Например, Основной SIP" maxlength="80" autocomplete="off" required autofocus></label>';
 }
 if(action==='trunk-sip'){
  name='Настройки SIP';
  submit='Сохранить настройки';
  fields=field('Хост SIP-сервера','server')+field('Порт SIP-сервера','port','number')+field('SIP-логин','login')+field('SIP-пароль','secret','password');
  warning='Используйте данные из кабинета SIP-оператора.';
 }
 if(action==='invite'||action==='internal-invite'){
  name='Пригласить сотрудника';
  submit='Добавить пользователя';
  fields='<label>Email<input name="email" type="email" required placeholder="name@company.ru" autocomplete="off"></label>'+'<div class="role-field"><span id="client-role-label">Роль</span><details class="role-picker"><summary aria-labelledby="client-role-label client-role-value"><span id="client-role-value">Менеджер</span>'+icon('chevron-down')+'</summary><div class="role-options">'+
   ['Менеджер','Администратор'].map((role,index)=>'<label><input type="radio" name="role" value="'+role+'"'+(index===0?' checked':'')+'><span>'+role+'</span></label>').join('')+'</div></details></div>';
 }
 if(action==='integration'){name='Создать интеграцию';fields='<label>Тип<select><option>amoCRM</option><option>Битрикс24</option><option>Webhook/API</option></select></label>';}
 if(action==='invoice'){name='Пополнение по счёту';submit='Сформировать счёт';fields=field('Сумма, ₽','amount','number');warning='Формирование счёта не зачисляет деньги. Баланс меняется после фактического поступления.';}
 if(action==='client'){
  name='Создать клиента';submit='Создать клиента';
  fields='<label>Название организации<input name="name" maxlength="180" placeholder="ООО «Название»" required></label>'+
   '<label>ИНН<input name="inn" inputmode="numeric" pattern="[0-9]{10}|[0-9]{12}" placeholder="10 или 12 цифр" required></label>'+
   '<label>Ответственный менеджер<select disabled><option>Не назначен</option></select></label>';
 }
 if(action==='admin-actions'){name='Действия организации';fields='<label>Операция<select id="admin-operation"><option value="credit">Пополнить баланс</option><option value="debit">Списать баланс</option>'+ (internalRole==='manager'?'':'<option value="payment-date">Изменить дату оплаты</option>')+'<option value="verify">Верифицировать</option><option value="unverify">Снять верификацию</option></select></label>'+field('Положительная сумма, ₽ / день оплаты','amount','number')+field('Основание','reason');warning='Изменение влияет на доступность новых звонков или расчёты. Уже выставленные документы не пересчитываются. Снятие верификации запретит активацию транков. Текущие разговоры не прерываются.';}
 const trigger=document.activeElement;
 dialog.classList.toggle('trunk-create-dialog',action==='trunk');
 dialog.innerHTML='<form method="dialog"><header><h2 id="dialog-title">'+esc(name)+'</h2><button class="icon-button" formnovalidate value="cancel" aria-label="Закрыть">'+icon('x')+'</button></header>'+
  (warning?'<p class="cabinet-muted">'+esc(warning)+'</p>':'')+'<div class="dialog-fields">'+fields+'</div>'+
  '<footer class="dialog-actions"><button class="button secondary" formnovalidate value="cancel">Отмена</button><button class="button" value="submit">'+esc(submit)+'</button></footer></form>';
 dialog.querySelector('form').onsubmit=event=>{
  if(event.submitter?.value!=='submit')return;
  event.preventDefault();
  showError('Не удалось выполнить действие. Попробуйте ещё раз.');
 };
 hydrate(dialog);dialog.showModal();
 dialog.querySelector('[name=secret]')?.setAttribute('autocomplete','new-password');
 const rolePicker=dialog.querySelector('.role-picker');
 if(rolePicker){
  rolePicker.onchange=event=>{rolePicker.querySelector('#client-role-value').textContent=event.target.value;rolePicker.open=false;rolePicker.querySelector('summary').focus();};
  rolePicker.onkeydown=event=>{if(event.key==='Escape'&&rolePicker.open){event.preventDefault();rolePicker.open=false;rolePicker.querySelector('summary').focus();}};
 }
 if(action==='admin-actions'){const select=dialog.querySelector('#admin-operation');const amount=dialog.querySelector('[name=amount]');select.onchange=()=>{amount.closest('label').hidden=['remove-limit','verify','unverify'].includes(select.value);};select.onchange();}
 dialog.onclose=()=>{dialog.querySelectorAll('input').forEach(el=>{el.value='';});dialog.replaceChildren();dialog.classList.remove('trunk-create-dialog');trigger?.focus({preventScroll:true});};
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
 wireWorkspacePicker();
 document.querySelectorAll('[data-action]').forEach(el=>el.onclick=async()=>{
 const action=el.dataset.action;
 if(action==='close-drawer'){setDrawer(false);return;}
 if(action==='sidebar'&&matchMedia('(max-width:768px)').matches){setDrawer(true);return;}
 if(action==='sidebar'){collapsed=!collapsed;try{localStorage.setItem('sashatel.web.sidebar',collapsed?'collapsed':'expanded');}catch{}render({focus:false});document.querySelector('[data-action=sidebar]').focus();return;}
 if(action==='theme'){const value=savedTheme()==='dark'?'light':'dark';try{localStorage.setItem('sashatel.web.theme',value);}catch{}document.documentElement.dataset.theme=value;el.innerHTML=icon(value==='dark'?'sun':'moon');hydrate(el);return;}
 if(action==='logout'){el.disabled=true;try{await api.logout();location.assign('/login/');}catch(e){el.disabled=false;showError(e.message);}return;}
 operation(action);
 });
 document.querySelectorAll('[data-review-org]').forEach(el=>el.onclick=()=>{
   reviewOrganizationDialog(el.dataset.reviewOrg,el.dataset.reviewDecision);
 });
 const filter=document.querySelector('#organization-filter');if(filter)filter.oninput=()=>{document.querySelectorAll('tbody tr').forEach(row=>{row.hidden=!row.textContent.toLowerCase().includes(filter.value.toLowerCase());});};
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
