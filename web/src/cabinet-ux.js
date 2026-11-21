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
const pill=(label,tone='neutral')=>'<span class="ux-pill ux-pill-'+tone+'">'+escape(label)+'</span>';
const sectionHeading=(subtitle,cta='')=>'<div class="ux-headline"><p class="ux-subtitle">'+subtitle+'</p>'+cta+'</div>';
function trunks(data=[],ctx={}){
 const rows=data.map(t=>[(t.id&&ctx.orgId?'<a class="ux-row-link" href="/'+escape(ctx.orgId)+'/trunks/'+escape(t.id)+'/"'+(ctx.review?' data-ux-open="trunk"':'')+'>'+escape(t.name)+'</a>':escape(t.name)),pill(t.registration||'Нет данных',t.registration==='Зарегистрирован'?'success':'neutral'),pill(t.ready||'Нет данных',t.ready==='Готов'?'success':'neutral'),pill(t.active?'Включён':'Выключен',t.active?'success':'neutral')]);
 return shell(sectionHeading('Подключения операторов и маршрутизация исходящих звонков',action('Создать транк','trunk',true))+'<section class="ux-section ux-list">'+table(['Транк','Регистрация','Готовность','Статус'],rows,'Транков пока нет')+(rows.length?'':hint('Подключите первый SIP-транк','После подключения здесь появятся транки, их номера и состояние соединения.'))+'</section>');
}
function employees(data=[]){
 const rows=data.map(e=>[escape(e.name),escape(e.email),pill(e.role||'Сотрудник'),pill(e.presence||'Не в сети',e.presence==='В сети'?'success':e.presence==='На линии'?'warning':'neutral')]);
 return shell(sectionHeading('Управление доступом и рабочими местами сотрудников',action('Пригласить сотрудника','invite',true))+'<section class="ux-section ux-list">'+table(['Сотрудник','Email','Роль','Присутствие'],rows,'Сотрудников пока нет')+(rows.length?'':hint('Пригласите команду','Сотрудники смогут войти в Desktop и совершать звонки с назначенным транком.'))+'</section>');
}
function integrations(data=[]){
 const integrations=[['amoCRM','CRM'],['Битрикс24','CRM'],['Webhook / API','Для разработчиков']];
 return shell(sectionHeading('Передача результатов звонков в CRM и внешние сервисы',action('Создать интеграцию','integration',true))+'<div class="ux-connectors">'+integrations.map(([name,type])=>{const connected=data.find(d=>d.type===name);return '<div class="ux-connector"><div class="ux-connector-symbol">'+escape(name[0])+'</div><div class="ux-connector-info"><strong>'+escape(name)+'</strong><span>'+escape(type)+'</span></div>'+pill(connected?'Подключено':'Не подключено',connected?'success':'neutral')+'</div>';}).join('')+'</div><p class="ux-footnote">Интеграции необязательны для работы телефонии. Звонки совершаются из Desktop, а результаты передаются после завершения.</p>');
}
function billing(data={}){
 const known=typeof data.accrued==='number';
 const summary=[['Начислено за период',known?int(data.accrued)+' ₽':'—'],['Подтверждённые платежи',typeof data.paid==='number'?int(data.paid)+' ₽':'—'],['К оплате',typeof data.due==='number'?int(data.due)+' ₽':'—']];
 const rows=(data.documents||[]).map(d=>[escape(d.name),escape(d.period),escape(d.amount),pill(d.status,d.status==='Оплачен'?'success':'neutral')]);
 return shell(sectionHeading('Начисления за подтверждённые разговоры и расчётные документы')+'<div class="ux-kpis ux-kpis-three">'+summary.map(([k,val])=>'<div class="ux-kpi"><span>'+k+'</span><strong>'+val+'</strong></div>').join('')+'</div><section class="ux-section ux-list">'+heading('Документы и начисления','Постоплата за фактически оказанные услуги')+table(['Документ','Период','Сумма','Статус'],rows,'Документов пока нет')+'</section><p class="ux-footnote">Тариф SashaTel: 3 ₽ за тарифицируемую минуту подтверждённого разговора с человеком. Расчёты стороннего оператора ведутся отдельно.</p>');
}
function history(data=[],ctx={}){
 const rows=data.map(c=>[(c.id&&ctx.orgId?'<a class="ux-row-link" href="/'+escape(ctx.orgId)+'/history/'+escape(c.id)+'/"'+(ctx.review?' data-ux-open="call"':'')+'>'+escape(c.date)+'</a>':escape(c.date)),escape(c.employee),escape(c.phone),escape(c.trunk),escape(c.duration),pill(c.status,c.status==='Дозвон'?'success':c.status==='Ошибка'?'error':'neutral')]);
 return shell(sectionHeading('Подробности, записи и результаты отдельных вызовов',calendar)+'<section class="ux-section ux-list">'+table(['Дата и время','Сотрудник','Абонент','Транк','Длительность','Результат'],rows,'За выбранный период звонков нет')+(rows.length?'':hint('История звонков пока пуста','После первых вызовов здесь появятся записи, результаты соединений и подробности разговоров.'))+'</section>');
}
function adminOverview(data={}){
 const companies=data.organizations||[];
 const summary=[['Организации',companies.length?int(companies.length):'—'],['Сотрудники',typeof data.employees==='number'?int(data.employees):'—'],['Общие минуты',typeof data.minutes==='number'?int(data.minutes):'—']];
 const rows=companies.map(o=>[escape(o.name),escape(o.inn),pill(o.verified?'Верифицирована':'Не верифицирована',o.verified?'success':'neutral'),escape(o.manager||'—')]);
 return shell(sectionHeading('Внутреннее управление организациями SashaTel')+'<div class="ux-kpis ux-kpis-three">'+summary.map(([k,val])=>'<div class="ux-kpi"><span>'+k+'</span><strong>'+val+'</strong></div>').join('')+'</div><section class="ux-section ux-list">'+heading('Организации','Организации с доступом к платформе')+table(['Организация','ИНН','Верификация','Ответственный'],rows,'Нет доступных организаций')+'</section>');
}
const kv=(pairs)=>'<dl class="ux-kv">'+pairs.map(([label,val])=>'<div><dt>'+escape(label)+'</dt><dd>'+escape(val??'Нет данных')+'</dd></div>').join('')+'</dl>';
function detailTab(id,name,active=false){return '<button type="button" role="tab" data-ux-detail="'+id+'" aria-selected="'+Boolean(active)+'">'+escape(name)+'</button>';}
function callDetail(ctx={}){
 const c=ctx.call;const back=ctx.orgId?'/'+escape(ctx.orgId)+'/history/':'#';
 const intro='<a class="ux-backlink" href="'+back+'">← История звонков</a>';
 if(!c)return shell(intro+hint('Не удалось загрузить детали вызова','Проверьте доступность записи или вернитесь к истории звонков.'));
 const summary=c.summary?'<p>'+escape(c.summary)+'</p>':'<p class="ux-subtitle">Саммари появится после обработки записи разговора.</p>';
 const transcript=c.transcript?.length?c.transcript.map(t=>'<div class="ux-transcript-line"><small>'+escape(t.time)+'</small><strong>'+escape(t.speaker)+'</strong><p>'+escape(t.text)+'</p></div>').join(''):'<p class="ux-subtitle">Транскрипт ещё не готов или запись недоступна.</p>';
 const details=kv([['Номер абонента',c.phone],['Сотрудник',c.employee],['Результат',c.status],['Длительность',c.duration],['Транк',c.trunk],['Caller ID',c.callerId],['Оператор',c.provider],['Регион нумерации',c.region],['Страна',c.country],['Часовой пояс',c.timezone],['SIP-код',c.sipCode],['Причина завершения',c.hangupReason],['Начало вызова',c.startedAt],['Соединение',c.connectedAt],['Окончание',c.endedAt],['CRM',c.crm]]);
 return shell(intro+'<div class="ux-call-hero"><div><p class="ux-eyebrow">ИСХОДЯЩИЙ ВЫЗОВ</p><h2>'+escape(c.phone)+'</h2><p class="ux-subtitle">'+escape(c.date)+' · '+escape(c.employee)+'</p></div>'+pill(c.status,c.status==='Дозвон'?'success':'neutral')+'</div><div class="ux-call-facts">'+[['Длительность',c.duration],['Транк',c.trunk],['Caller ID',c.callerId]].map(([key,val])=>'<div><span>'+escape(key)+'</span><strong>'+escape(val??'—')+'</strong></div>').join('')+'</div><section class="ux-section"><div class="ux-section-title"><h2>Саммари разговора</h2><span class="ux-note">Сгенерировано автоматически</span></div><div class="ux-call-summary">'+summary+'</div></section><section class="ux-section"><div class="ux-detail-tabs" role="tablist">'+detailTab('transcript','Транскрипт',true)+detailTab('details','Детали')+'</div><div class="ux-detail-panel" data-ux-detail-panel="transcript">'+transcript+'</div><div class="ux-detail-panel" data-ux-detail-panel="details" hidden>'+details+'</div></section>');
}
function numberRowsFor(numbers,status){
 return numbers.filter(n=>(n.status||'active')===status).map(n=>[escape(n.number),escape(n.spam||'—'),int(n.attempts),int(n.answers),number(n.attempts)?(number(n.answers)/number(n.attempts)*100).toLocaleString('ru-RU',{maximumFractionDigits:1})+'%':'—']);
}
function trunkDetail(ctx={}){
 const t=ctx.trunk,back=ctx.orgId?'/'+escape(ctx.orgId)+'/trunks/':'#';
 const intro='<a class="ux-backlink" href="'+back+'">← Все транки</a>';
 if(!t)return shell(intro+hint('Данные транка пока недоступны','Откройте транк из списка или повторите попытку позже.'));
 const management='<div class="ux-settings-row"><div><strong>Исходящие вызовы</strong><p>Новые звонки через этот транк '+(t.active?'разрешены':'приостановлены')+'. Текущие разговоры не прерываются.</p></div>'+pill(t.active?'Включён':'Выключен',t.active?'success':'neutral')+'</div><p class="ux-footnote">Карусель автоматически распределяет разрешённые Caller ID. Клиент не настраивает алгоритм оценки качества номеров.</p>';
 const numberRows=numberRowsFor(t.numbers||[],'active');
 const numbers='<div class="ux-detail-toolbar"><div class="ux-segment" role="group" aria-label="Фильтр номеров"><button type="button" data-ux-number="active" aria-pressed="true">Активные</button><button type="button" data-ux-number="passive" aria-pressed="false">Пассивные</button></div></div><div id="ux-numbers-table">'+table(['Номер','Спам-метка','Инициации','Ответы','Дозвон'],numberRows,'Нет номеров в выбранной группе')+'</div>';
 const information=kv([['SIP-сервер',t.host],['Порт',t.port],['Транспорт',t.transport],['Регистрация',t.registration],['Готовность к вызову',t.ready],['Режим авторизации',t.authType]]);
 return shell(intro+'<div class="ux-call-hero"><div><p class="ux-eyebrow">SIP-ТРАНК</p><h2>'+escape(t.name)+'</h2><p class="ux-subtitle">Статус подключения и управление Caller ID</p></div>'+pill(t.ready||'Неизвестно',t.ready==='Готов'?'success':'neutral')+'</div><div class="ux-detail-tabs" role="tablist">'+detailTab('management','Управление',true)+detailTab('numbers','Номера')+detailTab('information','Информация')+'</div><div class="ux-detail-panel" data-ux-detail-panel="management">'+management+'</div><div class="ux-detail-panel" data-ux-detail-panel="numbers" hidden>'+numbers+'</div><div class="ux-detail-panel" data-ux-detail-panel="information" hidden>'+information+'</div>');
}
export function sectionUI(page,ctx={}){
 if(ctx.admin)return page==='overview'?adminOverview(ctx.adminData):page==='employees'?listPage('Команда SashaTel','Управление внутренними сотрудниками',['Сотрудник','Email','Роль'],'Сотрудников пока нет','Назначения появятся после подключения внутреннего API.','',''):null;
 if(page==='statistics')return stats(ctx.stats);
 if(page==='history')return ctx.details?callDetail(ctx):history(ctx.history,ctx);
 if(page==='trunks')return ctx.details?trunkDetail(ctx):trunks(ctx.trunks,ctx);
 if(page==='employees')return employees(ctx.employees);
 if(page==='integrations')return integrations(ctx.integrations);
 if(page==='billing')return billing(ctx.billing);
 return null;
}
export function wireSectionUI(){
 const numbersPayload=document.querySelector('#ux-numbers-data')?.textContent;
 if(numbersPayload)document.querySelectorAll('[data-ux-number]').forEach(button=>button.addEventListener('click',()=>{const status=button.dataset.uxNumber;document.querySelectorAll('[data-ux-number]').forEach(el=>el.setAttribute('aria-pressed',String(el===button)));document.querySelector('#ux-numbers-table').innerHTML=table(['Номер','Спам-метка','Инициации','Ответы','Дозвон'],numberRowsFor(JSON.parse(numbersPayload),status),'Нет номеров в выбранной группе');}));

 document.querySelectorAll('[data-ux-detail]').forEach(tab=>tab.addEventListener('click',()=>{const target=tab.dataset.uxDetail;document.querySelectorAll('[data-ux-detail]').forEach(el=>el.setAttribute('aria-selected',String(el===tab)));document.querySelectorAll('[data-ux-detail-panel]').forEach(el=>el.hidden=el.dataset.uxDetailPanel!==target);}));

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
