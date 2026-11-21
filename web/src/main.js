import {api,isPreview} from './session.js';
import {notify} from './notifications.js';
import {esc,icon,link,button,table,empty,missing,tabs,metrics,range,hydrate} from './components.js';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const query=new URLSearchParams(location.search),previewSuffix=isPreview?'?preview=1'+(query.get('role')?'&role='+encodeURIComponent(query.get('role')):''):'';
let parts=location.pathname.split('/').filter(Boolean);const admin=parts[0]==='admin';
let account=null,org=null,organizations=[],internalOrganizations=[],internalRole=isPreview?(query.get('role')||'reviewer'):null;
if(!['admin','reviewer'].includes(internalRole))internalRole=null;
let page=admin?(parts[1]||'overview'):(parts[1]||'statistics'),service=isPreview&&query.get('service')==='1';
const nav=admin?[['overview','layout-dashboard','Обзор'],['employees','users','Сотрудники']]:[['statistics','activity','Статистика'],['history','history','История звонков'],['trunks','server','Транки'],['employees','users','Сотрудники'],['integrations','plug','Интеграции'],['billing','credit-card','Биллинг']];
let collapsed=false;
try{collapsed=localStorage.getItem('sashatel.web.sidebar')==='collapsed';}catch{}
const base=()=>admin?'/admin/':'/'+org.id+'/';
const url=section=>base()+(section==='overview'||section==='statistics'?'':section+'/')+previewSuffix;
const title=()=>nav.find(n=>n[0]===page)?.[2]||({profile:'Профиль',security:'Безопасность',organization:'Организация'}[page]||'Страница не найдена');
function filters(){return range()+(admin?'<label>Поиск организации<input type="search" id="organization-filter" placeholder="Название или ИНН"></label>':'');}
function clientPage(){
 if(page==='statistics')return '<div class="filters">'+range()+'<label>Сотрудник<select disabled><option>Все сотрудники</option></select></label><label>Транк<select disabled><option>Все транки</option></select></label>'+button(icon('download')+' CSV','export',true,true)+'</div>'+metrics(['Минуты','Инициации','Ответы','Дозвон'])+'<section class="chart-empty"><h2>Динамика звонков</h2><p>Нет данных за выбранный период</p></section><div class="split"><section><h2>Итоги набора</h2>'+missing('результатов звонков')+'</section><section><h2>По сотрудникам</h2>'+table(['Сотрудник','Инициации','Ответы','Дозвон','Средняя длительность'],[])+missing('статистики')+'</section></div>';
 if(page==='history'){
  if(parts[2])return '<a href="'+url('history')+'">К истории</a><h2>Карточка звонка</h2><p>Запись, транскрипт и саммари недоступны без подтверждённого источника.</p>'+tabs([['transcript','Транскрипт'],['details','Детали']],parts[3]||'transcript',base()+'history/'+parts[2]+'/')+table(['Поле','Значение'],['Номер абонента','Тип','Оператор','Регион нумерации','Страна','Часовой пояс','DEF / городской код','Caller ID','Транк','Начало / соединение / конец','Длительность / тарифицируемая','SIP-код','Причина завершения','CRM'].map(k=>[esc(k),'Нет данных']))+missing('карточки звонка');
  return '<div class="filters">'+range()+button(icon('download')+' CSV','export',true,true)+'</div>'+table(['Дата и время','Сотрудник','Номер','Транк','Длительность','Результат'],[])+missing('истории звонков');
 }
 if(page==='trunks'){
  if(parts[2])return '<a href="'+url('trunks')+'">К транкам</a>'+tabs([['management','Управление'],['numbers','Номера'],['information','Информация']],parts[3]||'management',base()+'trunks/'+parts[2]+'/')+(parts[3]==='numbers'?table(['Номер','Спам-метка','Инициации','Ответы','Дозвон'],[])+missing('номеров'):parts[3]==='information'?table(['Параметр','Значение'],['Регистрация SIP','Доступность','Ошибка','Сервер / порт','Транспорт','Авторизация','Endpoint / AOR'].map(k=>[k,'Нет данных'])): '<div class="warning">До верификации организации транк нельзя активировать.</div><div class="actions">'+button('Включить транк','activate',true)+button('Изменить SIP-данные','trunk',true,true)+button('Удалить транк','delete',true,true)+'</div>'+missing('управления транком'));
  return '<div class="page-actions">'+button(icon('plus')+' Создать транк','trunk')+'</div>'+table(['Название','Статус регистрации','Включён','Готовность к звонку'],[])+missing('транков');
 }
 if(page==='employees')return '<div class="page-actions">'+button(icon('plus')+' Пригласить сотрудника','invite')+'</div>'+table(['Имя и фамилия','Email','Телефон','Роль','Присутствие'],[])+missing('сотрудников и автоматического присутствия');
 if(page==='integrations')return '<div class="page-actions">'+button(icon('plus')+' Создать интеграцию','integration')+'</div>'+table(['Интеграция','Тип','Состояние'],[])+missing('amoCRM, Битрикс24 и Webhook/API');
 if(page==='billing')return metrics(['Баланс','Текущие начисления','Дата платежа'])+'<div class="page-actions">'+button('Сформировать счёт на пополнение','invoice')+'</div><h2>Документы и начисления</h2>'+table(['Документ','Период','Сумма','Статус','PDF'],[])+missing('биллинга и документов');
 if(page==='profile')return '<dl class="summary">'+[['Имя',account.first_name],['Фамилия',account.last_name],['Email',account.email],['Телефон',account.phone]].map(([k,v])=>'<dt>'+k+'</dt><dd>'+esc(v??'Не указано')+'</dd>').join('')+'</dl><p class="hint">Телефон не подтверждён. Он не используется для входа и восстановления доступа.</p>';
 if(page==='security')return '<h2>Сессии и пароль</h2>'+missing('управления сессиями и восстановления пароля')+button('Выйти из текущей сессии','logout');
 if(page==='organization')return '<dl class="summary"><dt>Название</dt><dd>'+esc(org.legal_name)+'</dd><dt>ИНН</dt><dd class="mono">'+esc(org.inn)+'</dd><dt>Верификация</dt><dd>'+esc(org.verification_status==='verified'?'Верифицирована':'Не верифицирована')+'</dd></dl><p>'+esc(org.verification_status==='verified'?'Изменение реквизитов — через проверку сотрудником SashaTel.':'Владелец и администратор могут изменять реквизиты до верификации.')+'</p>'+button('Изменить реквизиты','requisites',true,true);
 return empty('Страница не найдена','Выберите раздел в меню.');
}
function adminPage(){
 if(!internalRole)return empty('Служебный доступ запрещён','Доступ к организациям есть только у сотрудников SashaTel с подтверждёнными сервером полномочиями.',true);
 if(page==='employees')return missing('реестра внутренних сотрудников');
 if(page!=='overview')return empty('Страница не найдена','Выберите раздел в меню.');
 const filter='<div class="filters"><label>Поиск организации<input type="search" id="organization-filter" placeholder="Название или ИНН"></label></div>';
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
 return filter+table(['Организация','ИНН','Владелец','Проверка','Действия'],rows)+
   (rows.length?'':empty('Организаций нет','Новые организации появятся здесь после регистрации клиентов.'));
}
function render(){
 document.body.className='platform'+(collapsed?' sidebar-collapsed':'');document.documentElement.dataset.theme=savedTheme();
 document.body.innerHTML='<a class="skip" href="#content">К содержанию</a><aside class="sidebar"><div class="organization-head"><a href="'+(admin?'/admin/'+previewSuffix:'/'+org.id+'/'+previewSuffix)+'" title="'+esc(admin?'SashaTel':org.legal_name)+'"><strong>'+esc(admin?'SashaTel':org.legal_name)+'</strong><small>'+esc(admin?'Внутренняя платформа':org.inn)+'</small></a><button class="icon-button" data-action="sidebar" aria-label="'+(collapsed?'Развернуть':'Свернуть')+' меню" aria-pressed="'+collapsed+'">'+icon(collapsed?'panel-left-open':'panel-left-close')+'</button></div><nav aria-label="Основная навигация">'+nav.map(([id,glyph,label])=>link(url(id),icon(glyph)+'<span>'+label+'</span>',page===id).replace('<a ','<a aria-label="'+label+'" title="'+label+'" ')).join('')+'</nav>'+(!admin?'<div class="sidebar-bottom"><span>Баланс <b>—</b></span><span>Дата платежа <b>—</b></span><button class="text-button" data-action="organizations">Выбрать организацию</button></div>':'')+'</aside><div class="platform-body"><header class="platform-top"><span>'+esc(admin?'SashaTel / Внутренняя платформа':org.legal_name)+'</span><div class="top-controls">'+(isPreview?'<span class="fixture-badge">Preview · fixture</span>':'')+'<button class="icon-button" data-action="theme" aria-label="Переключить тему">'+icon(savedTheme()==='dark'?'sun':'moon')+'</button><details class="profile-menu"><summary>'+esc(account?.first_name||'Аккаунт')+' '+icon('chevron-down')+'</summary><div>'+link((org?'/'+org.id+'/profile/':'/login/')+previewSuffix,'Профиль')+link((org?'/'+org.id+'/security/':'/login/')+previewSuffix,'Безопасность')+(org?link('/'+org.id+'/organization/'+previewSuffix,'Организация'):'')+'<button class="text-button" data-action="logout">Выйти</button></div></details></div></header>'+(service?'<div class="service-banner">Служебный доступ · '+esc(account.first_name+' '+account.last_name)+' · '+link('/admin/?preview=1','Вернуться в обзор')+'</div>':'')+'<main id="content" tabindex="-1"><div class="page-heading"><div><h1 tabindex="-1">'+esc(title())+'</h1>'+(!admin&&org.verification_status!=='verified'?'<span class="status-label">Организация не верифицирована · телефония выключена</span>':'')+'</div></div><div id="page-content">'+(admin?adminPage():org.role==='employee'?empty('Кабинет организации','Управление доступно Владельцу и Администратору. Звонки — в Desktop.'):clientPage())+'</div><p id="platform-error" class="error" role="alert" tabindex="-1" hidden></p></main></div><dialog aria-labelledby="dialog-title" id="operation-dialog"></dialog>';
 hydrate();document.querySelector('h1')?.focus();wire();
}
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
 let name='',fields='',warning='';
 const field=(label,name,type='text')=>'<label>'+label+'<input name="'+name+'" type="'+type+'" required></label>';
 if(action==='trunk'){name='Создать UIS-транк';fields=field('Название','name')+field('SIP-сервер','server')+field('SIP-логин','login')+field('SIP-пароль','secret','password');warning='Новый транк выключен. До верификации организации активация недоступна.';}
 if(action==='invite'||action==='internal-invite'){name='Пригласить сотрудника';fields=field('Email','email','email')+'<label>Роль<select name="role">'+(action==='internal-invite'?'<option>Менеджер</option><option>Администратор</option>':'<option>Сотрудник</option><option>Администратор</option>')+'</select></label>';warning='Пароль задаёт сам пользователь. Приглашение не меняет права Владельца.';}
 if(action==='integration'){name='Создать интеграцию';fields='<label>Тип<select><option>amoCRM</option><option>Битрикс24</option><option>Webhook/API</option></select></label>';warning='Авторизация CRM и секреты требуют защищённого Backend API.';}
 if(action==='invoice'){name='Счёт на пополнение';fields=field('Сумма, ₽','amount','number');warning='Формирование счёта не зачисляет деньги. Баланс меняется после фактического поступления.';}
 if(action==='client'){name='Создать клиента';fields=field('ИНН','inn')+'<label>Ответственный менеджер<select disabled><option>Список недоступен</option></select></label>';warning='Организация создаётся неверифицированной. Владелец клиента может отсутствовать до назначения.';}
 if(action==='admin-actions'){name='Действия организации';fields='<label>Операция<select id="admin-operation"><option value="credit">Пополнить баланс</option><option value="debit">Списать баланс</option>'+ (internalRole==='manager'?'':'<option value="payment-date">Изменить дату оплаты</option>')+'<option value="verify">Верифицировать</option><option value="unverify">Снять верификацию</option></select></label>'+field('Положительная сумма, ₽ / день оплаты','amount','number')+field('Основание','reason');warning='Изменение влияет на доступность новых звонков или расчёты. Уже выставленные документы не пересчитываются. Снятие верификации запретит активацию транков. Текущие разговоры не прерываются.';}
 if(action==='organizations'){name='Выберите организацию';fields=organizations.map(o=>'<button type="button" class="button secondary" data-select-org="'+esc(o.id)+'">'+esc(o.legal_name)+'</button>').join('');warning=organizations.length?'Выбор проверяется сервером.':'Доступных организаций нет.';}
 dialog.innerHTML='<form method="dialog"><header><h2 id="dialog-title">'+esc(name)+'</h2><button class="icon-button" value="cancel" aria-label="Закрыть">'+icon('x')+'</button></header><div class="dialog-fields">'+fields+'</div><p>'+esc(warning)+'</p>'+(action==='organizations'?'':'<label class="check"><input type="checkbox"><span>Понимаю последствия операции</span></label><p class="warning">Операция недоступна: соответствующий API ещё не подключён.</p><button class="button" disabled>Подтвердить</button>')+'</form>';
 hydrate(dialog);dialog.showModal();dialog.querySelector('[name=secret]')?.setAttribute('autocomplete','new-password');
 if(action==='admin-actions'){const select=dialog.querySelector('#admin-operation');const amount=dialog.querySelector('[name=amount]');select.onchange=()=>{amount.closest('label').hidden=['remove-limit','verify','unverify'].includes(select.value);};select.onchange();}
 dialog.onclose=()=>{dialog.querySelectorAll('input').forEach(el=>{el.value='';});dialog.replaceChildren();};
 dialog.querySelectorAll('[data-select-org]').forEach(el=>el.onclick=async()=>{el.disabled=true;try{const result=await api.openOrganization(el.dataset.selectOrg);location.assign('/'+result.organization.id+'/'+previewSuffix);}catch(e){dialog.close();showError(e.message);} });
}
function showError(message){notify(message,'error');}
function wire(){
 document.querySelectorAll('[data-action]').forEach(el=>el.onclick=async()=>{
 const action=el.dataset.action;
 if(action==='sidebar'){collapsed=!collapsed;try{localStorage.setItem('sashatel.web.sidebar',collapsed?'collapsed':'expanded');}catch{}render();return;}
 if(action==='theme'){const value=savedTheme()==='dark'?'light':'dark';try{localStorage.setItem('sashatel.web.theme',value);}catch{}render();return;}
 if(action==='logout'){el.disabled=true;try{await api.logout();location.assign('/login/');}catch(e){el.disabled=false;showError(e.message);}return;}
 operation(action);
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
  if(uuid.test(parts[0]||'')){org=session.organization?.id===parts[0]?session.organization:(await api.openOrganization(parts[0])).organization;render();return;}
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
