// SashaTel Web UI v2: intentional zero-data states. No fixtures or fabricated account metrics.
const escape = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon=(name)=>'<span class="ux-icon" aria-hidden="true">'+({chart:'▥',phone:'↗',users:'♙',link:'⇄',invoice:'▤',server:'▣',spark:'✦',arrow:'→'}[name]||'·')+'</span>';
const action=(label,id,enabled=false)=>enabled?'<button class="ux-button" data-action="'+id+'">'+escape(label)+' <span aria-hidden="true">↗</span></button>':'';
const heading=(title,description,extra='')=>'<div class="ux-section-head"><div><h2>'+escape(title)+'</h2><p>'+escape(description)+'</p></div>'+extra+'</div>';
const hint=(title,description,cta='')=>'<div class="ux-empty"><div class="ux-empty-mark" aria-hidden="true">↗</div><strong>'+escape(title)+'</strong><p>'+escape(description)+'</p>'+cta+'</div>';
const shell=(body)=>'<div class="ux-page">'+body+'</div>';
const row=(cells)=>'<tr>'+cells.map((c,i)=>'<td'+(i?' class="ux-num"':'')+'>'+c+'</td>').join('')+'</tr>';
const table=(headers,rows,emptyText)=>'<div class="ux-table-viewport"><table class="ux-table"><thead><tr>'+headers.map(h=>'<th>'+escape(h)+'</th>').join('')+'</tr></thead><tbody>'+ (rows.length?rows.map(row).join(''):'<tr><td colspan="'+headers.length+'" class="ux-table-empty">'+escape(emptyText)+'</td></tr>')+'</tbody></table></div>';
const calendar='<div class="ux-date-wrap"><button type="button" class="ux-date" data-ux="calendar" aria-expanded="false" aria-controls="ux-date-panel"><span aria-hidden="true">▦</span> <span class="ux-date-label">Выбрать период</span> <span aria-hidden="true">⌄</span></button><form id="ux-date-panel" class="ux-date-panel" hidden><label>С даты<input type="date" name="from" required></label><label>По дату<input type="date" name="to" required></label><button class="ux-button" type="submit">Применить</button></form></div>';
const metrics=(data={})=>{const days=data.days||[];const attempts=days.reduce((v,d)=>v+number(d.attempts),0),answers=days.reduce((v,d)=>v+number(d.answers),0),minutes=days.reduce((v,d)=>v+number(d.minutes),0);const format=v=>Math.round(v).toLocaleString('ru-RU');return '<div class="ux-kpis">'+[['Минуты',format(minutes)],['Инициации',format(attempts)],['Ответы',format(answers)],['Дозвон',attempts?(answers/attempts*100).toLocaleString('ru-RU',{maximumFractionDigits:1})+'%':'—']].map(([name,value])=>'<div class="ux-kpi"><span>'+name+'</span><strong>'+value+'</strong></div>').join('')+'</div>';};
const statuses=['Дозвон','Автоответчик','Недозвон','Отклонено','Ошибка','Не распознано'];
const swatches=['#3c9880','#b99555','#858c9b','#bc836f','#bd6a70','#7887b2'];
const number=v=>Number.isFinite(Number(v))?Number(v):0;
const int=v=>Math.max(0,Math.round(number(v))).toLocaleString('ru-RU');
function donut(counts=[]){
 const values=statuses.map((_,i)=>Math.max(0,number(counts[i])));
 const total=values.reduce((a,b)=>a+b,0);
 const r=67,c=2*Math.PI*r;let offset=0;
 const slices=values.map((v,i)=>{const len=v/Math.max(total,1)*c,part='<circle cx="88" cy="88" r="'+r+'" fill="none" stroke="'+swatches[i]+'" stroke-width="17" stroke-dasharray="'+len+' '+(c-len)+'" stroke-dashoffset="'+(-offset)+'" transform="rotate(-90 88 88)"/> ';offset+=len;return v?part:'';}).join('');
 return '<section class="ux-section ux-results"><div class="ux-section-title"><h2>Результаты набора</h2></div><div class="ux-results-body"><div class="ux-donut"><svg viewBox="0 0 176 176" role="img" aria-label="Распределение результатов вызовов"><circle cx="88" cy="88" r="67" stroke="currentColor" stroke-opacity=".095" stroke-width="17" fill="none"/>'+slices+'</svg><div class="ux-donut-label"><strong>'+int(total)+'</strong><small>звонков</small></div></div><div class="ux-legend">'+statuses.map((name,i)=>'<div class="ux-legend-row"><span class="ux-legend-name"><i style="background:'+swatches[i]+'"></i>'+name+'</span><span class="ux-legend-value">'+(total?int(values[i])+' · '+(values[i]/total*100).toLocaleString('ru-RU',{maximumFractionDigits:1})+'%':'—')+'</span></div>').join('')+'</div></div></section>';
}
function chart(days=[]){
 const valid=days.filter(d=>d&&/^\d{4}-\d{2}-\d{2}$/.test(d.date));
 if(!valid.length)return '<section class="ux-section ux-chart"><div class="ux-section-title"><h2>Динамика дозвона</h2><span class="ux-note">Дозвон, %</span></div><div class="ux-chart-canvas" role="img" aria-label="Пока нет данных для графика дозвона"><div class="ux-chart-scale"><span>100%</span><span>75%</span><span>50%</span><span>25%</span><span>0%</span></div><div class="ux-chart-lines"><div class="ux-chart-grid"></div><div class="ux-chart-caption">График появится после первых звонков</div><div class="ux-chart-dates"><span>Начало периода</span><span>Конец периода</span></div></div></div></section>';
 const x=i=>30+i*840/Math.max(valid.length-1,1),y=d=>168-(Math.max(0,Math.min(100,number(d.reach)))*1.42);
 const points=valid.map((d,i)=>x(i)+','+y(d)).join(' ');
 const markers=valid.map((d,i)=>'<circle class="ux-point" cx="'+x(i)+'" cy="'+y(d)+'" r="6" tabindex="0" role="button" aria-label="'+escape(d.date)+', дозвон '+number(d.reach)+'%" data-ux-day="'+i+'"/>').join('');
 const labels=valid.map(d=>[d.date,number(d.reach),number(d.minutes),number(d.attempts),number(d.answers)]);
 return '<section class="ux-section ux-chart"><div class="ux-section-title"><h2>Динамика дозвона</h2><span class="ux-note">Дозвон, %</span></div><div class="ux-chart-interactive"><svg viewBox="0 0 900 190" role="img" aria-label="Динамика дозвона по дням"><g class="ux-grid-svg">'+[26,61.5,97,132.5,168].map(t=>'<line x1="30" y1="'+t+'" x2="870" y2="'+t+'"/>').join('')+'</g><polyline class="ux-line" points="'+points+'"/>'+markers+'</svg><div class="ux-day-tooltip" role="status" hidden></div></div><div class="ux-chart-dates"><span>'+escape(valid[0].date)+'</span><span>'+escape(valid[valid.length-1].date)+'</span></div><script type="application/json" id="ux-chart-data">'+JSON.stringify(labels).replace(/</g,'\\u003c')+'</script></section>';
}
function breakdownTable(kind,data={}){
 const rows=kind==='regions'?data.regions||[]:data.employees||[];
 return table([kind==='regions'?'Регион':'Сотрудник','Инициации','Ответы','Дозвон'],rows.map(o=>[escape(o.name),int(o.attempts),int(o.answers),number(o.attempts)?(number(o.answers)/number(o.attempts)*100).toLocaleString('ru-RU',{maximumFractionDigits:1})+'%':'—']), 'За выбранный период звонков пока нет');
}
function stats(data={}){
 return shell('<div class="ux-headline"><div><p class="ux-eyebrow">АНАЛИТИКА</p><p class="ux-subtitle">Обзор исходящих звонков организации</p></div>'+calendar+'</div>'+metrics(data)+chart(data.days||[])+'<div class="ux-two">'+donut(data.counts||[])+'<section class="ux-section ux-breakdown"><div class="ux-section-title ux-breakdown-header"><h2>Детализация</h2><div class="ux-segment" role="group" aria-label="Группировать статистику"><button data-ux-tab="employees" aria-pressed="true" type="button">По сотрудникам</button><button data-ux-tab="regions" aria-pressed="false" type="button">По регионам</button></div></div><div id="ux-breakdown-table">'+breakdownTable('employees',data)+'</div><script type="application/json" id="ux-breakdown-data">'+JSON.stringify({employees:data.employees||[],regions:data.regions||[]}).replace(/</g,'\\u003c')+'</script></section></div>');
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
 if(page==='statistics')return stats(ctx.stats);
 if(page==='history'&&!ctx.details)return history();
 if(page==='trunks'&&!ctx.details)return trunks();
 if(page==='employees')return employees();
 if(page==='integrations')return integrations();
 if(page==='billing')return billing();
 return null;
}
export function wireSectionUI(){
 const chartData=document.querySelector('#ux-chart-data');
 if(chartData){
  const days=JSON.parse(chartData.textContent),tip=document.querySelector('.ux-day-tooltip');
  const show=i=>{const [date,reach,minutes,attempts,answers]=days[i];tip.hidden=false;tip.innerHTML='<strong>'+escape(new Date(date+'T12:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'long'}))+'</strong><div>Дозвон <b>'+reach.toLocaleString('ru-RU',{maximumFractionDigits:1})+'%</b></div><div>Минут <b>'+int(minutes)+'</b></div><div>Инициаций <b>'+int(attempts)+'</b></div><div>Ответов <b>'+int(answers)+'</b></div>';};
  document.querySelectorAll('[data-ux-day]').forEach(el=>{el.addEventListener('pointerenter',()=>show(Number(el.dataset.uxDay)));el.addEventListener('focus',()=>show(Number(el.dataset.uxDay)));el.addEventListener('pointerleave',()=>tip.hidden=true);el.addEventListener('blur',()=>tip.hidden=true);});
 }
 document.querySelectorAll('[data-ux-tab]').forEach(button=>button.addEventListener('click',()=>{
  const next=button.dataset.uxTab;
  document.querySelectorAll('[data-ux-tab]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
  const raw=document.querySelector('#ux-breakdown-data')?.textContent;const parsed=raw?JSON.parse(raw):{};document.querySelector('#ux-breakdown-table').innerHTML=breakdownTable(next,parsed);
 }));
 document.querySelectorAll('[data-ux="calendar"]').forEach(b=>b.addEventListener('click',()=>{const panel=document.querySelector('#ux-date-panel');const open=panel.hidden;panel.hidden=!open;b.setAttribute('aria-expanded',String(open));if(open)panel.querySelector('input')?.focus();}));
 const dateForm=document.querySelector('#ux-date-panel');
 if(dateForm)dateForm.addEventListener('submit',event=>{event.preventDefault();const from=dateForm.elements.namedItem('from')?.value,to=dateForm.elements.namedItem('to')?.value;if(!from||!to)return;if(from>to){dateForm.elements.namedItem('to').setCustomValidity('Дата окончания должна быть позже даты начала');dateForm.reportValidity();return;}dateForm.elements.namedItem('to').setCustomValidity('');const format=d=>new Date(d+'T12:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'short'});document.querySelectorAll('.ux-date-label').forEach(el=>el.textContent=format(from)+' — '+format(to));dateForm.hidden=true;document.querySelector('[data-ux="calendar"]')?.setAttribute('aria-expanded','false');});
 dateForm?.querySelector('[name=to]')?.addEventListener('input',event=>event.target.setCustomValidity(''));
}
