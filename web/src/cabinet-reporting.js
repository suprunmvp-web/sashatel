import {esc} from './components.js';
import {renderRecordingButton} from './cabinet-recording.js';

// Date and call-filter markup from SashaTel-UI-Review-v2.html.
export function renderPeriod(label='Выберите даты',single=false){
 const prefix=single?'payment-':'';
 return `<div class="date-control${single?' single-date-control':''}">
<button aria-controls="${prefix}datePopover" aria-expanded="false" aria-haspopup="dialog" class="date-trigger" id="${prefix}dateTrigger" type="button">
<svg aria-hidden="true" viewbox="0 0 24 24"><rect height="16" rx="2" width="18" x="3" y="5"></rect><path d="M7 3v4m10-4v4M3 10h18"></path></svg>
<span id="${prefix}dateLabel">${esc(label)}</span>
<svg aria-hidden="true" class="date-chevron" viewbox="0 0 24 24"><path d="m7 10 5 5 5-5"></path></svg>
</button>
<div aria-label="${single?'Дата следующей оплаты':'Выбор периода'}" class="date-popover" hidden="" id="${prefix}datePopover" role="dialog">

<div class="calendar-area">
<div class="calendar-head"><button aria-label="Предыдущие месяцы" id="${prefix}calendarPrev" type="button"><svg viewbox="0 0 24 24"><path d="m15 18-6-6 6-6"></path></svg></button><span class="calendar-titles"><strong id="${prefix}calendarMonth"></strong>${single?'':'<strong id="calendarMonthNext"></strong>'}</span><button aria-label="Следующие месяцы" id="${prefix}calendarNext" type="button"><svg viewbox="0 0 24 24"><path d="m9 18 6-6-6-6"></path></svg></button></div>
<div class="calendar-pair"><div class="calendar-grid" id="${prefix}calendarDays"></div>${single?'':'<div class="calendar-grid" id="calendarDaysNext"></div>'}</div>

</div>
<div class="date-footer"><span id="${prefix}dateError" role="status"></span><button id="${prefix}dateReset" type="button" hidden>Сбросить</button><button id="${prefix}dateCancel" type="button">Отмена</button><button class="date-apply" id="${prefix}dateApply" type="button">Применить</button></div>
</div>
</div>`;
}
export function renderPeoplePicker(id, {label, searchLabel, dialogLabel, glyph='',items=[]}) {
 const options=[['',label],...items.map(value=>[value,value])];
 return `<button type="button" class="calls-filter-btn people-picker-trigger" id="${id}" popovertarget="${id}Options" aria-haspopup="dialog">
 ${glyph}<span>${esc(label)}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg></button>
 <div id="${id}Options" class="people-picker" popover role="dialog" aria-label="${esc(dialogLabel)}">
  <label class="picker-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><input type="search" autofocus autocomplete="off" aria-label="${esc(searchLabel)}" placeholder="${esc(searchLabel)}"></label>
  <div class="manager-choices">${options.map(([value,text],index)=>`<button type="button" data-person="${esc(value)}" aria-pressed="${index===0}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5L19 7"/></svg>${esc(text)}</button>`).join('')}</div>
  <p class="people-picker-empty" role="status" hidden>Ничего не найдено</p>
 </div>`;
}

export function wirePeoplePickers(root) {
 for (const panel of root.querySelectorAll('.people-picker')) {
  const trigger=panel.previousElementSibling;
  const search=panel.querySelector('input');
  const options=[...panel.querySelectorAll('button[data-person]')];
  const empty=panel.querySelector('.people-picker-empty');
  panel.addEventListener('toggle',event=>{
   if(event.newState!=='open')return;
   search.value='';
   search.dispatchEvent(new Event('input'));
   search.focus({preventScroll:true});
  });
  search.oninput=()=>{
   const term=search.value.trim().toLocaleLowerCase('ru');
   for(const option of options)option.hidden=!option.textContent.toLocaleLowerCase('ru').includes(term);
   empty.hidden=options.some(option=>!option.hidden);
  };
  for(const option of options)option.onclick=()=>{
   for(const item of options)item.setAttribute('aria-pressed',String(item===option));
   trigger.querySelector('span').textContent=option.textContent;
   trigger.dispatchEvent(new CustomEvent('personchange',{detail:option.dataset.person}));
   panel.hidePopover();
   trigger.focus({preventScroll:true});
  };
 }
}

export function renderCallFilters(historyBase, calls=[], suffix=''){
 const duration=seconds=>Number.isFinite(seconds)&&seconds>0?Math.floor(seconds/60)+':'+String(Math.floor(seconds%60)).padStart(2,'0'):'—';
 const rows=calls.map(call=>{
  const href=historyBase+encodeURIComponent(call.id)+'/'+suffix;
  const date=String(call.date||'').split('-').reverse().join('.');
  return `<tr data-call-date="${esc(call.date)}" data-call-status="${esc(call.status)}" data-employee="${esc(call.employee)}"><td>${esc(date)} <span class="cabinet-muted">${esc(call.time)}</span></td>
    <td><strong>${esc(call.employee||'—')}</strong></td>
    <td><a href="${esc(href)}" aria-label="Открыть звонок ${esc(call.phone)}">${esc(call.phone||'—')}</a></td>
    <td class="calls-recording-col">${renderRecordingButton(call)}</td><td class="calls-numeric">${duration(call.duration)}</td><td>${esc(call.status||'—')}</td></tr>`;
 }).join('');
 return `<div class="calls-filters-new">
   <label class="calls-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></svg><input id="callsSearch" type="search" inputmode="tel" placeholder="Поиск по номеру" aria-label="Поиск по номеру телефона"/></label>
   <div class="calls-filter-holder"><button type="button" class="calls-filter-btn" id="callsResultToggle" aria-expanded="false" aria-controls="callsResultMenu"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16l-6.5 7.5V19l-3 1.5v-8L4 5z"/></svg><span id="callsResultLabel">Все результаты</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg></button><div class="calls-option-menu" id="callsResultMenu" hidden></div></div>
   <div class="calls-filter-holder">${renderPeoplePicker('callsEmployeeToggle',{
     label:'Все сотрудники',searchLabel:'Поиск сотрудника',dialogLabel:'Фильтр по сотруднику',
     items:[...new Set(calls.map(call=>call.employee).filter(Boolean))].sort(new Intl.Collator('ru').compare),
     glyph:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3 20v-1.4a6 6 0 0 1 12 0V20M17 8a3 3 0 0 1 0 6M17 17a5 5 0 0 1 4 3"/></svg>'
   })}</div>
  
    ${renderPeriod('Все даты')}</div>
<div class="calls-table-wrap" tabindex="0" role="region" aria-label="Таблица звонков"><table class="calls-table calls-table-new"><thead><tr><th>Дата и время</th><th>Сотрудник</th><th>Номер</th><th class="calls-recording-col"><span class="sr-only">Запись</span></th><th class="calls-numeric">Длительность</th><th>Результат</th></tr></thead><tbody id="callsRows">${rows}<tr${rows?' hidden':''} id="callsEmpty"><td colspan="6" class="calls-empty">Нет данных</td></tr></tbody></table></div>
  <div class="calls-foot" id="callsFoot"><span id="callsCount" role="status">Всего: ${calls.length}</span><div class="calls-pagination"><button id="callsPrev" disabled type="button" aria-label="Предыдущая страница"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg></button><span id="callsPageNum">—</span><button id="callsNext" disabled type="button" aria-label="Следующая страница"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></button></div></div>`;
}

export function wireCallHistory(root){
 const resultToggle=root.querySelector('#callsResultToggle');
 if(!resultToggle)return;
 const menu=root.querySelector('#callsResultMenu');
 const search=root.querySelector('#callsSearch');
 const rows=[...root.querySelectorAll('#callsRows tr[data-call-date]')];
 const empty=root.querySelector('#callsEmpty');
 const previous=root.querySelector('#callsPrev');
 const next=root.querySelector('#callsNext');
 const count=root.querySelector('#callsCount');
 const pageLabel=root.querySelector('#callsPageNum');
 const pageSize=12;
 let page=0, status='', employee='', range=[];
 function update(){
  const phone=search.value.replace(/\D/g,'');
  const [from,to]=range;
  const filtered=rows.filter(row=>{
   const {callDate,callStatus}=row.dataset;
   return (!status||callStatus===status)&&(!employee||employee===row.dataset.employee)&&(!phone||row.cells[2].textContent.replace(/\D/g,'').includes(phone))&&
    (!from||callDate>=from)&&(!to||callDate<=to);
  });
  const pages=Math.ceil(filtered.length/pageSize);
  const visible=new Set(filtered.slice(page*pageSize,(page+1)*pageSize));
  for(const row of rows)row.hidden=!visible.has(row);
  empty.hidden=Boolean(filtered.length);
  count.textContent='Всего: '+filtered.length;
  pageLabel.textContent=pages?`${page+1} из ${pages}`:'—';
  previous.disabled=page===0;
  next.disabled=page+1>=pages;
 }
 function setMenu(open){
  menu.hidden=!open;
  resultToggle.setAttribute('aria-expanded',String(open));
  if(open)menu.querySelector('[aria-pressed=true]').focus();
 }
 for(const [index,label] of ['Все результаты','Дозвон','Автоответчик','Недозвон','Отклонено','Ошибка','Не распознано'].entries()){
  const option=document.createElement('button');
  option.type='button';
  option.setAttribute('aria-pressed',String(index===0));
  option.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5L19 7"/></svg>'+label;
  option.onclick=()=>{
   status=index?label:'';
   root.querySelector('#callsResultLabel').textContent=label;
   for(const button of menu.children)button.setAttribute('aria-pressed',String(button===option));
   page=0;
   update();
   setMenu(false);
   resultToggle.focus();
  };
  menu.append(option);
 }
 resultToggle.onclick=()=>setMenu(menu.hidden);
 menu.onkeydown=event=>{if(event.key==='Escape'){setMenu(false);resultToggle.focus();}};
 menu.parentElement.onfocusout=event=>{if(event.relatedTarget&&!event.currentTarget.contains(event.relatedTarget))setMenu(false);};
 search.oninput=()=>{page=0;update();};
 root.querySelector('#callsEmployeeToggle').addEventListener('personchange',event=>{employee=event.detail;page=0;update();});
 previous.onclick=()=>{page--;update();};
 next.onclick=()=>{page++;update();};
 root.querySelector('.calls-filters-new .date-control').addEventListener('periodchange',event=>{
  range=event.detail;
  page=0;
  update();
 });
 update();
}

const dayFormat=new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'short'});
const monthFormat=new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric'});
const weekdays=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];

export function wirePeriod(root,single=false){
 const prefix=single?'payment-':'';
 const find=id=>root.querySelector('#'+prefix+id);
 const trigger=find('dateTrigger');
 if(!trigger)return;
 const panel=find('datePopover');
 const label=find('dateLabel');
 const defaultLabel=label.textContent;
 const apply=find('dateApply');
 const reset=find('dateReset');
 let month=new Date();
 month=new Date(month.getFullYear(),month.getMonth(),1);
 let range=[],draft=[];
 const sameDay=(a,b)=>+a===+b;
 function close(){
  panel.hidden=true;
  trigger.setAttribute('aria-expanded','false');
  trigger.focus({preventScroll:true});
 }
 function draw(){
  for(const [offset,gridId,titleId] of [[0,'calendarDays','calendarMonth'],[1,'calendarDaysNext','calendarMonthNext']]){
   const first=new Date(month.getFullYear(),month.getMonth()+offset,1);
   const year=first.getFullYear(),number=first.getMonth();
   const grid=find(gridId);
   if(!grid)continue;
   find(titleId).textContent=monthFormat.format(first);
   grid.replaceChildren(...weekdays.map(day=>Object.assign(document.createElement('span'),{textContent:day})));
   for(let i=0;i<(first.getDay()+6)%7;i++)grid.append(document.createElement('span'));
   for(let day=1;day<=new Date(year,number+1,0).getDate();day++){
    const date=new Date(year,number,day);
    const button=document.createElement('button');
    button.type='button';
    button.textContent=day;
    button.setAttribute('aria-label',date.toLocaleDateString('ru-RU'));
    button.setAttribute('aria-pressed',String(draft.some(d=>sameDay(d,date))));
    if(draft.length===2&&date>=draft[0]&&date<=draft[1])button.classList.add('in-range');
    button.onclick=()=>{
     draft=!single&&draft.length===1?[draft[0],date].sort((a,b)=>a-b):[date];
     draw();
     [...grid.querySelectorAll('button')][day-1]?.focus();
    };
    grid.append(button);
   }
  }
  apply.disabled=!draft.length;
  reset.hidden=!range.length&&!draft.length;
 }
 trigger.onclick=()=>{
  if(!panel.hidden){close();return;}
  draft=range.slice();
  draw();
  panel.hidden=false;
  trigger.setAttribute('aria-expanded','true');
  find('calendarPrev').focus();
 };
 for(const [id,step] of [['calendarPrev',-1],['calendarNext',1]])find(id).onclick=()=>{
  month=new Date(month.getFullYear(),month.getMonth()+step,1);draw();
 };
 apply.onclick=()=>{
  range=draft.slice();
  const [first,last=first]=range;
  label.textContent=sameDay(first,last)?first.toLocaleDateString('ru-RU'):`${dayFormat.format(first)} — ${dayFormat.format(last)} ${last.getFullYear()}`;
  publish(single?[first]:[first,last]);
  close();
 };
 function publish(dates){
  const localDate=date=>[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
  trigger.dispatchEvent(new CustomEvent('periodchange',{bubbles:true,detail:dates.map(localDate)}));
 }
 reset.onclick=()=>{range=[];draft=[];label.textContent=defaultLabel;publish([]);close();};
 find('dateCancel').onclick=close;
 panel.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}});
 panel.closest('.date-control').addEventListener('focusout',event=>{
  if(event.relatedTarget&&!event.currentTarget.contains(event.relatedTarget)){panel.hidden=true;trigger.setAttribute('aria-expanded','false');}
 });
}

const callDetailTabs = [
 ['transcript', `Транскрипция`],
 ['details', `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/></svg>О контакте`],
 ['agreements', `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 7 4-2 4 2m10 0-4-2-6 2-3 4 2 2 4-3 5 5-5 5-8-5-3-3 1-5m17 0 1 5-3 3m-7 0 4 3"/></svg>Договорённости`],
];
export function renderCallDetails(back, base, current, call) {
 const active=callDetailTabs.some(([id])=>id===current)?current:'transcript';
 const headings={transcript:'Транскрипция',details:'О контакте',agreements:'Договорённости'};
 const contact=active==='details'&&call?.contact!=null;
 const payload=contact?JSON.stringify(call.contact,null,2):'';
 const agreement=active==='agreements'&&call?.agreement;
 const fields=agreement?[
  ['Имя клиента',agreement.customerName],['Согласие получено',typeof agreement.consent==='boolean'?(agreement.consent?'Да':'Нет'):null],
  ['Время по МСК',agreement.moscowTime],['Локальное время',agreement.localTime]
 ]:[];
 const details=agreement?[
  ['Договорённости',agreement.agreements],['Факты о клиенте',agreement.facts],['Текст SMS',agreement.sms]
 ]:[];
 const body=contact?`<div id="callsTechBody"><pre tabindex="0" aria-label="Данные контакта в JSON"><code id="callContactJson">${esc(payload)}</code></pre><span id="callJsonStatus" role="status"></span></div>`:
  agreement?`<div class="agreement-section"><dl>${fields.map(([key,value])=>'<div><dt>'+key+'</dt><dd>'+esc(value??'—')+'</dd></div>').join('')}</dl>
   ${details.filter(([,value])=>value).map(([key,value])=>'<h3>'+key+'</h3><article>'+esc(value)+'</article>').join('')}</div>`:
  '<p class="cabinet-muted">Нет данных</p>';
 return `<div class="calls-detail-top"><a class="calls-back-icon" href="${back}" aria-label="Назад к истории звонков"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5m7-7-7 7 7 7"/></svg></a>${renderRecordingButton(call)}</div>
 <nav class="tabs calls-tabs" aria-label="Карточка звонка">${callDetailTabs.map(([id,body])=>`<a href="${base}${id}/"${active===id?' aria-current="page"':''}>${body}</a>`).join('')}</nav>
 <section class="calls-section"><div class="calls-section-title"><h2>${headings[active]}</h2>${contact?'<button type="button" id="callCopyJson" class="button secondary">Копировать JSON</button>':''}</div>${body}</section>`;
}

const outcomeColors=['#e2e3e7','#b9bbc3','#8b8d98','#666872','#b58c43','#444650'];
const donutRadius=64;
const circumference=2*Math.PI*donutRadius;
function renderOutcomes(outcomes,number,percent){
 const total=outcomes.reduce((sum,{count})=>sum+count,0);
 let offset=0;
 const segments=outcomes.map(({label,count},index)=>{
  const share=total?count/total:0;
  const length=share*circumference;
  const color=outcomeColors[index%outcomeColors.length];
  const segment=count>0?`<circle class="donut-segment" data-slice="${index}" cx="90" cy="90" r="${donutRadius}" fill="none" stroke="${color}" stroke-width="21" stroke-dasharray="${length} ${circumference-length}" stroke-dashoffset="${-offset}" transform="rotate(-90 90 90)" aria-label="${esc(label)}: ${percent.format(share)}"/>`:'';
  offset+=length;
  const item=`<div class="outcome-item" data-slice="${index}" tabindex="0"><svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="5" fill="${color}"/></svg><span>${esc(label)}</span><strong>${total?percent.format(share):'—'}</strong></div>`;
  return {segment,item};
 });
 return `<div class="outcomes-content">
  <div class="donut-wrap"><svg aria-label="Распределение результатов набора" id="outcomeDonut" role="img" viewBox="0 0 180 180"><circle cx="90" cy="90" r="${donutRadius}" fill="none" stroke="currentColor" stroke-width="21"/>${segments.map(({segment})=>segment).join('')}</svg>
  <div class="donut-center"><strong id="donutTotal">${outcomes.length?number.format(total):'—'}</strong><small>попыток</small></div></div>
  <div class="outcomes-legend-wrap"><div class="outcomes-col-head"><span>Результат</span><span>Доля</span></div><div class="outcomes-legend" id="outcomesLegend">${outcomes.length?segments.map(({item})=>item).join(''):'Нет данных'}</div></div>
 </div>`;
}
export function renderStatistics(days=[],{outcomes=[],regions=[]}={}) {
 const totals=days.reduce((values,{minutes,attempts,answers})=>[values[0]+minutes,values[1]+attempts,values[2]+answers],[0,0,0]);
 const [minutes,attempts,answers]=totals;
 const number=new Intl.NumberFormat('ru-RU');
 const percent=new Intl.NumberFormat('ru-RU',{style:'percent',maximumFractionDigits:1});
 const labels=['Потрачено минут','Попытки звонка','Ответы','Дозвон'];
 const values=[number.format(minutes),number.format(attempts),number.format(answers),percent.format(attempts?answers/attempts:0)];
 const kpi=labels.map((label,index)=>
  `<div class="stat-kpi"><span class="stat-kpi-label">${label}</span><strong class="stat-kpi-value"${days.length?'':' aria-label="Нет данных"'}>${days.length?values[index]:'—'}</strong></div>`
 ).join('');
 const chartAttrs=days.length?` tabindex="0" data-days="${esc(JSON.stringify(days))}" aria-label="Дозвон по дням. Стрелки влево и вправо выбирают день"`:' aria-label="Дозвон по дням. Нет данных"';
 const grid=[14,64,113,163,212].map(y=>`<line x1="58" x2="986" y1="${y}" y2="${y}" stroke="var(--line)" stroke-width="1"/>`).join('');
 return `<div class="stats-page"><div aria-label="Ключевые показатели" class="stats-kpis" id="statsKpis">${kpi}</div>
<section aria-label="График дозвона" class="reach-block">
<div class="block-top"><h2>Дозвон по дням</h2></div>
<div class="reach-chart" id="reachChart" role="group"${chartAttrs}><div class="graph-y-scale" aria-hidden="true"><span>60%</span><span>45%</span><span>30%</span><span>15%</span><span>0%</span></div>
<svg aria-label="Линейный график процента дозвона по дням" preserveaspectratio="none" role="img" viewbox="0 0 1000 250"><g id="graphGrid">${grid}</g><path class="graph-area" id="graphArea"></path><path class="graph-line" id="graphLine"></path></svg>
<div aria-hidden="true" class="graph-hover-marker" id="graphHoverMarker" hidden><span class="graph-hover-core"></span></div>
<div class="graph-tooltip" hidden="" id="graphTooltip" aria-hidden="true"><div class="tip-date"></div><div class="tip-reach"><span>Дозвон</span><strong></strong></div><div class="tip-details"><div><span>Минут</span><b></b></div><div><span>Попыток</span><b></b></div><div><span>Ответов</span><b></b></div></div></div>
</div>
${days.length?'<span class="sr-only" id="graphAnnouncement" role="status"></span>':'<p class="stats-chart-empty" role="status">Нет данных за выбранный период</p>'}<div class="graph-labels" id="graphDates"></div>

</section>
<div class="stats-bottom">
<section aria-label="Результаты набора" class="outcomes-block">
<h2>Результаты звонков</h2>
${renderOutcomes(outcomes,number,percent)}
</section>
<section aria-label="Детализация статистики" class="breakdown-block">
<div class="breakdown-heading"><h2>Звонки по регионам</h2></div>
<div class="region-content"><div class="region-table-viewport"><table class="breakdown-table"><thead><tr><th>Регион</th><th>Попытки</th><th>Доля</th></tr></thead><tbody id="breakdownRows">${regions.length?regions.map(({label,attempts:count})=>'<tr><td>'+esc(label)+'</td><td>'+number.format(count)+'</td><td>'+(attempts?percent.format(count/attempts):'—')+'</td></tr>').join(''):'<tr><td colspan="3" class="stats-region-empty">Нет данных</td></tr>'}</tbody></table></div></div>
</section>
</div></div>`;
}
