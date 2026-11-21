// SashaTel Web UI v2: intentional zero-data states. No fixtures or fabricated account metrics.
const escape = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon=(name)=>'<span class="ux-icon" aria-hidden="true">'+({chart:'▥',phone:'↗',users:'♙',link:'⇄',invoice:'▤',server:'▣',spark:'✦',arrow:'→'}[name]||'·')+'</span>';
const action=(label,id,enabled=false)=>enabled?'<button class="ux-button" data-action="'+id+'">'+escape(label)+' <span aria-hidden="true">↗</span></button>':'';
const heading=(title,description,extra='')=>'<div class="ux-section-head"><div><h2>'+escape(title)+'</h2><p>'+escape(description)+'</p></div>'+extra+'</div>';
const hint=(title,description,cta='')=>'<div class="ux-empty"><div class="ux-empty-mark" aria-hidden="true">↗</div><strong>'+escape(title)+'</strong><p>'+escape(description)+'</p>'+cta+'</div>';
const shell=(body)=>'<div class="ux-page">'+body+'</div>';
const row=(cells)=>'<tr>'+cells.map((c,i)=>'<td'+(i?' class="ux-num"':'')+'>'+c+'</td>').join('')+'</tr>';
const table=(headers,rows,emptyText)=>'<div class="ux-table-viewport"><table class="ux-table"><thead><tr>'+headers.map(h=>'<th>'+escape(h)+'</th>').join('')+'</tr></thead><tbody>'+ (rows.length?rows.map(row).join(''):'<tr><td colspan="'+headers.length+'" class="ux-table-empty">'+escape(emptyText)+'</td></tr>')+'</tbody></table></div>';
const calendar='<button type="button" class="ux-date" data-ux="calendar" aria-label="Выбрать период"><span aria-hidden="true">▦</span> <span>Выбрать период</span> <span aria-hidden="true">⌄</span></button>';
const strip='<div class="ux-kpis">'+[['Минуты','0'],['Инициации','0'],['Ответы','0'],['Дозвон','—']].map(([name,value])=>'<div class="ux-kpi"><span>'+name+'</span><strong>'+value+'</strong></div>').join('')+'</div>';
const statuses=['Дозвон','Автоответчик','Недозвон','Отклонено','Ошибка','Не распознано'];
const swatches=['#3c9880','#b99555','#858c9b','#bc836f','#bd6a70','#7887b2'];
function donut(){
 return '<section class="ux-section ux-results"><div class="ux-section-title"><h2>Результаты набора</h2></div><div class="ux-results-body"><div class="ux-donut"><svg viewBox="0 0 176 176" role="img" aria-label="Нет результатов вызовов"><circle cx="88" cy="88" r="67" stroke="currentColor" stroke-opacity=".095" stroke-width="17" fill="none"/></svg><div class="ux-donut-label"><strong>0</strong><small>звонков</small></div></div><div class="ux-legend">'+statuses.map((name,i)=>'<div class="ux-legend-row"><span class="ux-legend-name"><i style="background:'+swatches[i]+'"></i>'+name+'</span><span class="ux-legend-value">—</span></div>').join('')+'</div></div></section>';
}
function chart(){
 return '<section class="ux-section ux-chart"><div class="ux-section-title"><h2>Динамика дозвона</h2><span class="ux-note">Дозвон, %</span></div><div class="ux-chart-canvas" role="img" aria-label="Пока нет данных для графика дозвона"><div class="ux-chart-scale"><span>100%</span><span>75%</span><span>50%</span><span>25%</span><span>0%</span></div><div class="ux-chart-lines"><div class="ux-chart-grid"></div><div class="ux-chart-caption">График появится после первых звонков</div><div class="ux-chart-dates"><span>Начало периода</span><span>Конец периода</span></div></div></div></section>';
}
function stats(){
 return shell('<div class="ux-headline"><div><p class="ux-eyebrow">АНАЛИТИКА</p><p class="ux-subtitle">Обзор исходящих звонков организации</p></div>'+calendar+'</div>'+strip+chart()+'<div class="ux-two">'+donut()+'<section class="ux-section ux-breakdown"><div class="ux-section-title ux-breakdown-header"><h2>Детализация</h2><div class="ux-segment" role="group" aria-label="Группировать статистику"><button data-ux-tab="employees" aria-pressed="true" type="button">По сотрудникам</button><button data-ux-tab="regions" aria-pressed="false" type="button">По регионам</button></div></div><div id="ux-breakdown-table">'+table(['Сотрудник','Инициации','Ответы','Дозвон'],[],'За выбранный период звонков пока нет')+'</div></section></div>');
}
function listPage(label,info,headers,emptyTitle,emptyText,actionLabel,actionId){
 return shell('<div class="ux-headline"><p class="ux-subtitle">'+escape(info)+'</p>'+ (actionLabel?action(actionLabel,actionId,true):'')+'</div><section class="ux-section ux-list">'+heading(label,'')+table(headers,[],emptyTitle)+hint(emptyTitle,emptyText)+'</section>');
}
function trunks(){
 return shell('<div class="ux-headline"><p class="ux-subtitle">Подключения операторов и маршрутизация исходящих звонков</p>'+action('Создать транк','trunk',true)+'</div><section class="ux-section ux-list">'+table(['Транк','Регистрация','Готовность','Статус'],[],'Транков пока нет')+hint('Подключите первый SIP-транк','После подключения здесь появятся транки, их номера и состояние соединения.')+'</section>');
}
function employees(){
 return shell('<div class="ux-headline"><p class="ux-subtitle">Управление доступом и рабочими местами сотрудников</p>'+action('Пригласить сотрудника','invite',true)+'</div><section class="ux-section ux-list">'+table(['Сотрудник','Email','Роль','Присутствие'],[],'Сотрудников пока нет')+hint('Пригласите команду','Сотрудники смогут войти в Desktop и совершать звонки с назначенным транком.')+'</section>');
}
function integrations(){
 return shell('<div class="ux-headline"><p class="ux-subtitle">Передача результатов звонков в CRM и внешние сервисы</p>'+action('Создать интеграцию','integration',true)+'</div><div class="ux-connectors">'+[['amoCRM','CRM'],['Битрикс24','CRM'],['Webhook / API','Для разработчиков']].map(([name,type])=>'<div class="ux-connector"><div class="ux-connector-symbol">'+escape(name[0])+'</div><div><strong>'+escape(name)+'</strong><span>'+escape(type)+'</span></div><span class="ux-connector-tail">Не подключено</span></div>').join('')+'</div><p class="ux-footnote">Интеграции необязательны для совершения звонков. Подключение станет доступно после интеграции API.</p>');
}
function billing(){
 return shell('<div class="ux-headline"><p class="ux-subtitle">Начисления за подтверждённые разговоры и расчётные документы</p></div><div class="ux-kpis ux-kpis-three">'+[['Начислено за период','—'],['Подтверждённые платежи','—'],['К оплате','—']].map(([k,v])=>'<div class="ux-kpi"><span>'+k+'</span><strong>'+v+'</strong></div>').join('')+'</div><section class="ux-section ux-list">'+heading('Документы и начисления','Постоплата за фактически оказанные услуги')+table(['Документ','Период','Сумма','Статус'],[],'Документов пока нет')+'</section><p class="ux-footnote">Тариф SashaTel: 3 ₽ за тарифицируемую минуту подтверждённого разговора с человеком. Расчёты стороннего оператора ведутся отдельно.</p>');
}
function history(){
 return shell('<div class="ux-headline"><p class="ux-subtitle">Подробности, записи и результаты отдельных вызовов</p>'+calendar+'</div><section class="ux-section ux-list">'+table(['Дата и время','Сотрудник','Абонент','Транк','Длительность','Результат'],[],'За выбранный период звонков нет')+hint('История звонков пока пуста','После первых вызовов здесь появятся записи, результаты соединений и подробности разговоров.')+'</section>');
}
function adminOverview(){
 return shell('<div class="ux-headline"><p class="ux-subtitle">Внутреннее управление организациями SashaTel</p></div><div class="ux-kpis ux-kpis-three">'+[['Организации','—'],['Сотрудники','—'],['Общие минуты','—']].map(([k,v])=>'<div class="ux-kpi"><span>'+k+'</span><strong>'+v+'</strong></div>').join('')+'</div><section class="ux-section ux-list">'+heading('Организации','Организации с доступом к платформе')+table(['Организация','ИНН','Верификация','Ответственный'],[],'Нет доступных организаций')+'</section>');
}
export function sectionUI(page,ctx={}){
 if(ctx.admin)return page==='overview'?adminOverview():page==='employees'?listPage('Команда SashaTel','Управление внутренними сотрудниками',['Сотрудник','Email','Роль'],'Сотрудников пока нет','Назначения появятся после подключения внутреннего API.','',''):null;
 if(page==='statistics')return stats();
 if(page==='history'&&!ctx.details)return history();
 if(page==='trunks'&&!ctx.details)return trunks();
 if(page==='employees')return employees();
 if(page==='integrations')return integrations();
 if(page==='billing')return billing();
 return null;
}
export function wireSectionUI(){
 document.querySelectorAll('[data-ux-tab]').forEach(button=>button.addEventListener('click',()=>{
  const next=button.dataset.uxTab;
  document.querySelectorAll('[data-ux-tab]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
  document.querySelector('#ux-breakdown-table').innerHTML=table([next==='regions'?'Регион':'Сотрудник','Инициации','Ответы','Дозвон'],[],'За выбранный период звонков пока нет');
 }));
 document.querySelectorAll('[data-ux="calendar"]').forEach(b=>b.addEventListener('click',()=>{b.blur();const input=document.querySelector('#ux-date-range');if(input){input.hidden=!input.hidden;input.focus();}else{const el=document.createElement('input');el.id='ux-date-range';el.type='date';el.className='ux-native-date';b.after(el);el.focus();el.showPicker?.();}}));
}
