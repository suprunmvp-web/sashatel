// Date and call-filter markup from SashaTel-UI-Review-v2.html.
export function renderPeriod(label='Выберите даты'){
 return `<div class="date-control">
<button aria-controls="datePopover" aria-expanded="false" aria-haspopup="dialog" class="date-trigger" id="dateTrigger" type="button">
<svg aria-hidden="true" viewbox="0 0 24 24"><rect height="16" rx="2" width="18" x="3" y="5"></rect><path d="M7 3v4m10-4v4M3 10h18"></path></svg>
<span id="dateLabel">${label}</span>
<svg aria-hidden="true" class="date-chevron" viewbox="0 0 24 24"><path d="m7 10 5 5 5-5"></path></svg>
</button>
<div aria-label="Выбор периода статистики" class="date-popover" hidden="" id="datePopover" role="dialog">

<div class="calendar-area">
<div class="calendar-head"><button aria-label="Предыдущие месяцы" id="calendarPrev" type="button"><svg viewbox="0 0 24 24"><path d="m15 18-6-6 6-6"></path></svg></button><span class="calendar-titles"><strong id="calendarMonth"></strong><strong id="calendarMonthNext"></strong></span><button aria-label="Следующие месяцы" id="calendarNext" type="button"><svg viewbox="0 0 24 24"><path d="m9 18 6-6-6-6"></path></svg></button></div>
<div class="calendar-pair"><div class="calendar-grid" id="calendarDays"></div><div class="calendar-grid" id="calendarDaysNext"></div></div>

</div>
<div class="date-footer"><span id="dateError" role="status"></span><button id="dateReset" type="button" hidden>Сбросить</button><button id="dateCancel" type="button">Отмена</button><button class="date-apply" id="dateApply" type="button">Применить</button></div>
</div>
</div>`;
}
export function renderCallFilters(){
 return `<div class="calls-filters-new">
   <label class="calls-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></svg><input id="callsSearch" type="search" inputmode="tel" placeholder="Поиск по номеру" aria-label="Поиск по номеру телефона"/></label>
   <div class="calls-filter-holder"><button type="button" class="calls-filter-btn" id="callsResultToggle" aria-expanded="false" aria-controls="callsResultMenu"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16l-6.5 7.5V19l-3 1.5v-8L4 5z"/></svg><span id="callsResultLabel">Все результаты</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg></button><div class="calls-option-menu" id="callsResultMenu" hidden></div></div>
   <div class="calls-filter-holder"><button type="button" class="calls-filter-btn" id="callsEmployeeToggle" aria-expanded="false" disabled><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3 20v-1.4a6 6 0 0 1 12 0V20M17 8a3 3 0 0 1 0 6M17 17a5 5 0 0 1 4 3"/></svg><span id="callsEmployeeLabel">Все сотрудники</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg></button></div>
  
    ${renderPeriod('Все даты')}</div>
<div class="calls-table-wrap" tabindex="0" role="region" aria-label="Таблица звонков"><table class="calls-table calls-table-new"><thead><tr><th>Дата и время</th><th>Сотрудник</th><th>Номер</th><th class="calls-recording-col"><span class="sr-only">Запись</span></th><th class="calls-numeric">Длительность</th><th>Результат</th></tr></thead><tbody id="callsRows"><tr><td colspan="6" class="calls-empty">Нет данных</td></tr></tbody></table></div>
  <div class="calls-foot" id="callsFoot"><span id="callsCount" role="status"></span><div class="calls-pagination"><button id="callsPrev" disabled type="button" aria-label="Предыдущая страница"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg></button><span id="callsPageNum">—</span><button id="callsNext" disabled type="button" aria-label="Следующая страница"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></button></div></div>`;
}

const dayFormat=new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'short'});
const monthFormat=new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric'});
const weekdays=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];

export function wirePeriod(root){
 const trigger=root.querySelector('#dateTrigger');
 if(!trigger)return;
 const panel=root.querySelector('#datePopover');
 const label=root.querySelector('#dateLabel');
 const defaultLabel=label.textContent;
 const apply=root.querySelector('#dateApply');
 const reset=root.querySelector('#dateReset');
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
   const grid=root.querySelector('#'+gridId);
   root.querySelector('#'+titleId).textContent=monthFormat.format(first);
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
     draft=draft.length===1?[draft[0],date].sort((a,b)=>a-b):[date];
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
  root.querySelector('#calendarPrev').focus();
 };
 for(const [id,step] of [['calendarPrev',-1],['calendarNext',1]])root.querySelector('#'+id).onclick=()=>{
  month=new Date(month.getFullYear(),month.getMonth()+step,1);draw();
 };
 apply.onclick=()=>{
  range=draft.slice();
  const [first,last=first]=range;
  label.textContent=sameDay(first,last)?first.toLocaleDateString('ru-RU'):`${dayFormat.format(first)} — ${dayFormat.format(last)} ${last.getFullYear()}`;
  close();
 };
 reset.onclick=()=>{range=[];draft=[];label.textContent=defaultLabel;close();};
 root.querySelector('#dateCancel').onclick=close;
 panel.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();close();}});
 panel.closest('.date-control').addEventListener('focusout',event=>{
  if(event.relatedTarget&&!event.currentTarget.contains(event.relatedTarget)){panel.hidden=true;trigger.setAttribute('aria-expanded','false');}
 });
}

const callDetailTabs = [
 ['transcript', `Транскрипция`],
 ['details', `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/></svg>О контакте`],
 ['agreements', `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 7 4-2 4 2m10 0-4-2-6 2-3 4 2 2 4-3 5 5-5 5-8-5-3-3 1-5m17 0 1 5-3 3m-7 0 4 3"/></svg>Договорённости`],
];
export function renderCallDetails(back, base, current) {
 const active=callDetailTabs.some(([id])=>id===current)?current:'transcript';
 const headings={transcript:'Транскрипция',details:'О контакте',agreements:'Договорённости'};
 return `<div class="calls-detail-top"><a class="calls-back-icon" href="${back}" aria-label="Назад к истории звонков"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5m7-7-7 7 7 7"/></svg></a></div>
 <nav class="tabs calls-tabs" aria-label="Карточка звонка">${callDetailTabs.map(([id,body])=>`<a href="${base}${id}/"${active===id?' aria-current="page"':''}>${body}</a>`).join('')}</nav>
 <section class="calls-section"><div class="calls-section-title"><h2>${headings[active]}</h2></div><p class="cabinet-muted">Нет данных</p></section>`;
}

export function renderStatistics() {
 const kpi=['Потрачено минут','Попытки звонка','Ответы','Дозвон'].map(label=>
  `<div class="stat-kpi"><span class="stat-kpi-label">${label}</span><strong class="stat-kpi-value" aria-label="Нет данных">—</strong></div>`
 ).join('');
 const grid=[14,64,113,163,212].map(y=>`<line x1="58" x2="986" y1="${y}" y2="${y}" stroke="var(--line)" stroke-width="1"/>`).join('');
 return `<div class="stats-page"><div aria-label="Ключевые показатели" class="stats-kpis" id="statsKpis">${kpi}</div>
<section aria-label="График дозвона" class="reach-block">
<div class="block-top"><h2>Дозвон по дням</h2></div>
<div class="reach-chart" id="reachChart" role="group" aria-label="Дозвон по дням. Нет данных"><div class="graph-y-scale" aria-hidden="true"><span>60%</span><span>45%</span><span>30%</span><span>15%</span><span>0%</span></div>
<svg aria-label="Линейный график процента дозвона по дням" preserveaspectratio="none" role="img" viewbox="0 0 1000 250"><g id="graphGrid">${grid}</g><path class="graph-area" id="graphArea"></path><path class="graph-line" id="graphLine"></path></svg>
<div aria-hidden="true" class="graph-hover-marker" id="graphHoverMarker" hidden><span class="graph-hover-core"></span></div>
<div class="graph-tooltip" hidden="" id="graphTooltip" aria-hidden="true"><div class="tip-date"></div><div class="tip-reach"></div><div class="tip-details"></div></div>
</div>
<p class="stats-chart-empty" role="status">Нет данных за выбранный период</p><div class="graph-labels" id="graphDates"></div>

</section>
<div class="stats-bottom">
<section aria-label="Результаты набора" class="outcomes-block">
<h2>Результаты звонков</h2>
<div class="outcomes-content"><div class="donut-wrap"><svg aria-label="Распределение результатов набора" id="outcomeDonut" role="img" viewBox="0 0 180 180"><circle cx="90" cy="90" r="70" fill="none" stroke="currentColor" stroke-width="20"/></svg><div class="donut-center"><strong id="donutTotal">—</strong><small>попыток</small></div></div><div class="outcomes-legend-wrap"><div class="outcomes-col-head"><span>Результат</span><span>Доля</span></div><div class="outcomes-legend" id="outcomesLegend">Нет данных</div></div></div>
</section>
<section aria-label="Детализация статистики" class="breakdown-block">
<div class="breakdown-heading"><h2>Звонки по регионам</h2></div>
<div class="region-content"><div class="region-table-viewport"><table class="breakdown-table"><thead><tr><th>Регион</th><th>Попытки</th><th>Доля</th></tr></thead><tbody id="breakdownRows"><tr><td colspan="3" class="stats-region-empty">Нет данных</td></tr></tbody></table></div></div>
</section>
</div></div>`;
}
