import {renderPeriod} from './cabinet-reporting.js';
import {esc} from './components.js';

// Markup from SashaTel-UI-Review-v2.html. Native dialog and server operations are wired separately.
const templates = {
  create: `<div class="tc-dialog-head"><div><h2 id="tcCreateTitle">Создать транк</h2></div><button type="button" id="tcCreateClose" aria-label="Закрыть" class="tc-close">×</button></div><form id="tcCreateForm" autocomplete="off"><label class="tc-field tc-create-name" for="tcCreateName">Название транка<input id="tcCreateName" name="name" maxlength="80" required placeholder="Например, Основной SIP" autocomplete="off"/></label><div class="tc-dialog-actions"><button type="button" id="tcCreateCancel" class="tc-button">Отмена</button><button type="submit" class="tc-button tc-primary">Создать транк</button></div></form>`,
  sip: `<div class="tc-dialog-head"><div><h2 id="tcSipTitle">Настройка SIP-транка</h2><p>Укажите данные для подключения к SIP-провайдеру</p></div><button type="button" id="tcSipClose" aria-label="Закрыть" class="tc-close">×</button></div><form id="tcSipForm" autocomplete="off"><div class="tc-sip-grid"><label class="tc-field">Хост SIP-сервера<input id="tcManageHost" type="text" maxlength="255" required placeholder="sip.provider.ru"/></label><label class="tc-field">SIP-логин<input id="tcManageUser" type="text" autocomplete="off" required placeholder="Логин оператора"/></label><label class="tc-field">SIP-пароль<input id="tcManagePassword" type="password" autocomplete="new-password" placeholder="Пароль SIP-провайдера"/></label><label class="tc-field">Основной номер телефона<input id="tcMainPhone" type="tel" autocomplete="off" inputmode="tel" placeholder="+7" maxlength="30" aria-describedby="sipPhoneHint"/><small id="sipPhoneHint">В международном формате</small></label><input id="tcManagePort" type="hidden" value="5060"></div><div class="tc-dialog-actions"><button id="tcSipCancel" type="button" class="tc-button">Отмена</button><button type="submit" class="tc-button tc-primary">Сохранить настройки</button></div></form>`,
  rename: `<div class="tc-dialog-head"><h2 id="tcRenameTitle">Переименовать транк</h2><button type="button" id="tcRenameClose" aria-label="Закрыть" class="tc-close">×</button></div><form id="tcRenameForm" autocomplete="off"><label class="tc-field tc-create-name" for="tcRenameName">Название транка<input id="tcRenameName" name="name" maxlength="80" required autocomplete="off"/></label><div class="tc-dialog-actions"><button type="button" id="tcRenameCancel" class="tc-button">Отмена</button><button type="submit" class="tc-button tc-primary">Сохранить</button></div></form>`,
};

export function showTrunkDialog(dialog, kind, onSubmit) {
  const titleId = {create: 'tcCreateTitle', sip: 'tcSipTitle', rename: 'tcRenameTitle'}[kind];
  const trigger = document.activeElement;
  dialog.classList.add('reference-trunk-dialog');
  dialog.setAttribute('aria-labelledby', titleId);
  const frame = document.createElement('div');
  frame.className = 'tc-dialog ' + (kind === 'sip' ? 'tc-sip-dialog' : 'tc-create-dialog');
  frame.innerHTML = templates[kind];
  dialog.replaceChildren(frame);
  const form = frame.querySelector('form');
  const input = form.querySelector('input:not([type=hidden])');
  for (const button of frame.querySelectorAll('button[type=button]')) {
    button.addEventListener('click', () => dialog.close());
  }
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!input.value.trim()) {
      input.setCustomValidity('Введите название или данные подключения.');
      input.reportValidity();
      input.addEventListener('input', () => input.setCustomValidity(''), {once: true});
      return;
    }
    onSubmit();
  });
  dialog.onclose = () => {
    if (dialog.open) return;
    dialog.replaceChildren();
    dialog.setAttribute('aria-labelledby', 'dialog-title');
    dialog.classList.remove('reference-trunk-dialog');
    trigger?.focus({preventScroll: true});
  };
  dialog.showModal();
  input.focus({preventScroll: true});
}

export const trunkManagementMarkup = `<section id="tcManage" class="tc-editor tc-control-screen" role="tabpanel" aria-label="Управление">
      <form id="tcManageForm" autocomplete="off">
        
        <div class="tc-control-row">
          <div class="tc-control-copy"><strong>Транк включён</strong><small>Разрешает новые исходящие звонки через этот транк</small></div>
          <label class="tc-switch"><input id="tcManageEnabled" type="checkbox" disabled aria-label="Транк включён"/><span class="tc-switch-track"></span></label>
        </div>
        <div class="tc-control-row">
          <div class="tc-control-copy"><strong>Основной транк</strong><small>Используется по умолчанию при выборе SIP-маршрута</small></div>
          <label class="tc-switch"><input id="tcManageDefault" type="checkbox" disabled aria-label="Основной транк"/><span class="tc-switch-track"></span></label>
        </div>
        <div class="tc-control-row">
          <div class="tc-control-copy"><strong>SIP-подключение</strong><small>Сервер оператора, порт и учётные данные</small></div>
          <button id="tcSipOpen" data-action="trunk-sip" class="tc-button tc-control-action" type="button">Настроить</button>
        </div>
        <div class="tc-control-row">
          <div class="tc-control-copy"><strong>Проверить подключение</strong><small>Диагностика SIP без совершения платного звонка</small></div>
          <button id="tcCheckConnect" class="tc-button tc-control-action" type="button" disabled>Проверить</button>
        </div>
        <p id="tcManageFeedback" class="tc-inline-feedback" role="status" hidden></p>
      </form>
    </section>`;

export function renderTrunkNumbers() {
 return `<section id="tcNumbers" class="tc-numbers" role="tabpanel" aria-label="Номера">
      <div class="tc-number-toolbar"><div class="tc-numbers-search"><label class="tc-search-field"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><span class="sr-only">Поиск по номеру телефона</span><input id="tcNumberSearch" type="search" placeholder="Поиск по номеру телефона" autocomplete="off" aria-label="Поиск по номеру телефона"/></label></div><div class="tc-number-tools"><div class="tc-number-filter"><button type="button" id="tcNumberFilterBtn" aria-expanded="false" aria-controls="tcNumberFilterPop"><svg class="tc-filter-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18l-7 8v6l-4 2v-8L3 5Z"/></svg><span id="tcNumberFilterLabel">Все статусы</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg></button><div class="tc-number-filter-pop" id="tcNumberFilterPop" role="group" aria-label="Статусы номеров" hidden><button type="button" data-number-filter="all" aria-pressed="true"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 12 5 5 11-11"/></svg>Все</button><button type="button" data-number-filter="active" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 12 5 5 11-11"/></svg>Активные</button><button type="button" data-number-filter="passive" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 12 5 5 11-11"/></svg>Пассивные</button></div></div>${renderPeriod('Дата добавления')}</div><div class="tc-number-meta"><button class="tc-button" id="tcNumberExport" disabled type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/></svg>Скачать CSV</button></div></div>
      
      <div id="tcNumberBulk" class="tc-number-actions" hidden><span id="tcBulkCaption" role="status"></span><button type="button" class="tc-button tc-bulk-button" id="tcNumberMove"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h15m0 0-4-4m4 4-4 4M20 17H5m0 0 4-4m-4 4 4 4"/></svg><span id="tcSelectedCount">Перенести</span></button></div><div class="tc-table-panel"><div class="tc-table-scroll"><table class="tc-table tc-number-table"><thead><tr><th class="tc-number-check"><input type="checkbox" id="tcNumberAll" disabled aria-label="Выбрать все видимые номера"/></th><th>Номер</th><th>Статус</th><th>Спам-метка</th><th>Инициации</th><th>Ответы</th><th>Дозвон</th><th>Дата добавления</th></tr></thead><tbody id="tcNumberRows"><tr><td class="tc-number-empty" colspan="8">Нет данных</td></tr></tbody></table></div></div>
      <div class="tc-number-footer" id="tcNumberCount" role="status">Номеров: —</div><p class="tc-inline-feedback" id="tcNumberFeedback" role="status"></p>
    </section>`;
}

export function renderTrunkInformation(id) {
 const row=(label,value='—')=>`<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`;
 return `<section id="tcInfo" class="tc-info" aria-label="Информация">
  <section class="tc-info-section"><h2>Состояние подключения</h2><dl class="tc-info-grid" id="tcInfoStatus">${row('Регистрация SIP')}${row('Доступность')}</dl></section>
  <section class="tc-info-section"><h2>Технические параметры</h2><dl id="tcInfoTech" class="tc-info-grid">${row('ID транка',id)}${row('SIP-сервер')}${row('SIP-порт')}</dl>
   <details class="tc-more-tech"><summary>Показать технические детали</summary><dl class="tc-info-grid tc-tech-extra">${row('Транспорт')}${row('Авторизация')}${row('Endpoint / AOR')}</dl></details>
  </section>
 </section>`;
}

export function wireTrunkNumbers(root) {
 const trigger=root.querySelector('#tcNumberFilterBtn');
 if(!trigger)return;
 const menu=root.querySelector('#tcNumberFilterPop');
 const options=[...menu.querySelectorAll('button')];
 function close() {
  menu.hidden=true;
  trigger.setAttribute('aria-expanded','false');
  trigger.focus();
 }
 trigger.onclick=()=>{
  if(!menu.hidden){close();return;}
  menu.hidden=false;
  trigger.setAttribute('aria-expanded','true');
  menu.querySelector('[aria-pressed=true]').focus();
 };
 for(const option of options)option.onclick=()=>{
  for(const row of options)row.setAttribute('aria-pressed',String(row===option));
  root.querySelector('#tcNumberFilterLabel').textContent=option.dataset.numberFilter==='all'?'Все статусы':option.textContent.trim();
  close();
 };
 menu.onkeydown=event=>{if(event.key==='Escape'){event.preventDefault();close();}};
}

export const trunkLandingMarkup = `<div id="trunkLanding" class="tc-list-view">
    <header class="tc-page-head"><div><h1 tabindex="-1">Транки</h1></div><button type="button" id="tcConnect" data-action="trunk" class="tc-button tc-primary"><span aria-hidden="true">＋</span> Подключить транк</button></header>
    <div class="tc-table-panel" id="tcListPanel"><div class="tc-table-scroll" tabindex="0" role="region" aria-label="Список транков"><table class="tc-table tc-trunk-list"><thead><tr><th>Название</th><th>Состояние</th><th class="tc-list-actions-heading"><span class="sr-only">Действия</span></th></tr></thead><tbody id="tcTrunkRows"><tr><td colspan="3" class="tc-empty">Нет данных</td></tr></tbody></table></div></div>
    
  </div>`;

export function renderTrunkHeader(back, base, tab, query) {
 const items = [['management','Управление'],['information','Информация'],['numbers','Номера']];
 return `<header class="tc-detail-head">
      <div class="tc-detail-leading">
        <a href="${esc(back)}" class="tc-back" id="tcBack" aria-label="К списку транков" title="К списку транков"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6M8 12h12"/></svg></a>
        <div class="tc-title-block"><div class="tc-title-row"><h1 id="tcTrunkName" tabindex="-1">Транк</h1><span id="tcHeroStatus" class="tc-status"></span></div><p id="tcTrunkServer"></p></div>
      </div>
      <button type="button" class="tc-button" id="tcHeaderTest" disabled>Тестовый звонок</button>
    </header>
 <nav class="tc-tabs" aria-label="Карточка транка">${items.map(([id,label]) =>
  `<a class="tc-tab" href="${esc(base+id+'/'+query)}"${tab===id?' aria-current="page"':''}>${label}</a>`
 ).join('')}</nav>`;
}
