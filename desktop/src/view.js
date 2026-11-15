import { icon } from './icons.js';
import { displayNumber, duration, sanitizePhone } from './format.js';

const stateLabels = { idle: 'Готов к набору', connecting: 'Соединяем…', ringing: 'Ожидаем ответа…', active: 'Разговор', terminating: 'Завершаем…', ended: 'Вызов завершён', failed: 'Не удалось соединиться' };
/** @type {Record<import('./contracts').HistoryItem['status'], string>} */
const historyStatusLabels = { answered: 'Завершён', cancelled: 'Отменён', missed: 'Без ответа', failed: 'Ошибка', unknown: 'Результат неизвестен' };
const reasons = {
  cancelled: 'Вызов отменён до ответа.', 'no-answer': 'Абонент не ответил.',
  rejected: 'Абонент отклонил вызов.', 'connection-lost': 'Соединение потеряно.',
  'transport-error': 'Ошибка телефонии. Проверьте подключение.',
  'setup-timeout': 'Не удалось установить соединение.', 'ring-timeout': 'Абонент не ответил.',
  'termination-timeout': 'Завершение не подтверждено.',
  'termination-error': 'Не удалось подтвердить завершение вызова.',
};

/** @param {HTMLElement} root @param {import('./controller').DesktopController} controller */
export function mountDesktop(root, controller) {
  const { services } = controller;
  const isDemo = services.calls.mode === 'demo';
  root.innerHTML = `
    <div class="shell">
      <header class="titlebar">
        <div class="brand"><img src="assets/sashatel-logo.svg" width="28" height="28" alt=""><span>SashaTel</span><span class="desktop-label">Desktop</span></div>
        <button type="button" id="theme-toggle" class="icon-button" aria-label="Переключить тему" title="Переключить тему"></button>
      </header>
      <div class="workspace-bar">
        <div class="operator"><span class="avatar" aria-hidden="true">${isDemo ? 'Д' : 'О'}</span><div><strong>${isDemo ? 'Демо-оператор' : 'Оператор'}</strong><span id="operator-status">Свободен</span></div></div>
        <div class="connection"><span class="status-dot"></span><span id="connection-status"></span></div>
      </div>
      <div class="mode-note">${icon('info')}<span>${isDemo ? '<b>Демо-вызовы</b> · телефония не подключена' : 'Рабочий режим · ручные исходящие звонки'}</span></div>
      <main id="main" tabindex="-1">
        <section id="dialer-screen" aria-labelledby="dialer-title">
          <div class="page-heading"><div><p class="eyebrow">РАБОЧЕЕ МЕСТО</p><h1 id="dialer-title">Новый звонок</h1></div><span class="tag">${isDemo ? 'DEMO' : 'Исходящий'}</span></div>
          <div class="dialer-body">
            <label for="phone" class="field-label">Номер телефона</label>
            <div class="number-field"><input id="phone" type="tel" inputmode="tel" autocomplete="off" spellcheck="false" maxlength="32" placeholder="+7 999 123-45-67" aria-describedby="phone-help ui-error"><button type="button" id="erase" class="icon-button" aria-label="Удалить символ" title="Удалить символ">${icon('backspace')}</button></div>
            <p class="helper" id="phone-help">Россия · 10 цифр или номер с +7 / 8</p>
            <div id="last-result" class="result-note" role="status" hidden></div>
            <p id="ui-error" class="error-note" role="alert" hidden></p>
            <div class="keypad" aria-label="Цифровая клавиатура">
              ${[['1',''],['2','АБВ'],['3','ГДЕ'],['4','ЖЗИ'],['5','КЛМ'],['6','НОП'],['7','РСТ'],['8','УФХ'],['9','ЦЧШ'],['+',''],['0',''],['','']].map(([digit, letters]) => digit ? `<button type="button" class="key" data-digit="${digit}" aria-label="${digit === '+' ? 'Плюс' : digit}"><span>${digit}</span><small>${letters || '&nbsp;'}</small></button>` : `<button type="button" id="key-erase" class="key" aria-label="Стереть цифру">${icon('backspace')}<small>стереть</small></button>`).join('')}
            </div>
            <button type="button" id="call" class="button primary call-button">${icon('phone')}<span>${isDemo ? 'Тестовый звонок' : 'Позвонить'}</span><kbd>↵</kbd></button>
            <p class="keyboard-hint">Enter — начать вызов <span>·</span> ⌘ / Ctrl + V — вставить</p>
          </div>
        </section>
        <section id="call-screen" aria-labelledby="call-title" hidden>
          <div class="page-heading"><div><p class="eyebrow">${isDemo ? 'ДЕМОНСТРАЦИЯ' : 'ИСХОДЯЩИЙ ВЫЗОВ'}</p><h1 id="call-title">Исходящий вызов</h1></div><span class="tag">${isDemo ? 'DEMO' : 'Вызов'}</span></div>
          <div class="call-body">
            <div id="call-avatar" class="call-avatar">${icon('phone')}</div>
            <h2 id="call-number"></h2>
            <p id="call-state" class="call-state" role="status"></p><p id="call-error" class="error-note" role="alert" hidden></p>
            <p id="call-timer" class="call-timer" aria-label="Длительность разговора">—:—</p>
            <p id="call-description" class="helper"></p>
            <button type="button" id="hangup" class="button danger">${icon('hangup')}<span>Завершить</span></button>
            <div id="demo-controls" class="demo-controls" ${isDemo && services.demo ? '' : 'hidden'}>
              <div class="demo-controls-heading">События демо-адаптера</div>
              <p>Ответ не происходит автоматически. Эти кнопки имитируют события, звук не передаётся.</p>
              <div class="demo-buttons"><button type="button" class="button small" data-event="ringing">Гудки</button><button type="button" class="button small" data-event="connected">Ответ</button><button type="button" class="button small" data-event="rejected">Отказ</button><button type="button" class="button small" data-event="connection-lost">Обрыв</button><button type="button" class="button small" data-event="remote-ended">Абонент завершил</button></div>
            </div>
          </div>
        </section>
        <section id="history-screen" aria-labelledby="history-title" hidden>
          <div class="page-heading"><div><p class="eyebrow">ИСХОДЯЩИЕ</p><h1 id="history-title">История звонков</h1></div><button type="button" id="refresh-history" class="icon-button" aria-label="Обновить историю" title="Обновить историю">${icon('retry')}</button></div>
          <p class="section-description">${isDemo ? 'Тестовые вызовы этой сессии. При закрытии история очищается.' : 'История вызовов из сервиса SashaTel.'}</p>
          <div id="history-content" aria-live="polite"></div>
        </section>
        <section id="settings-screen" aria-labelledby="settings-title" hidden>
          <div class="page-heading"><div><p class="eyebrow">РАБОЧЕЕ МЕСТО</p><h1 id="settings-title">Настройки</h1></div></div>
          <div class="settings-content">
            <h2 class="section-label">Аудиоустройства</h2>
            <div class="audio-notice" id="audio-notice" role="status"></div>
            <div class="settings-card">
              <label for="microphone" class="field-label">${icon('mic')}Микрофон</label>
              <select id="microphone" aria-describedby="audio-permission"></select>
              <div class="test-row"><div class="meter" role="meter" aria-label="Уровень микрофона" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">${Array.from({length: 16}, () => '<i></i>').join('')}</div><button type="button" id="test-microphone" class="button small">Проверить</button></div>
              <p class="helper" id="audio-permission"></p>
              <button type="button" id="request-microphone" class="button small" hidden>Разрешить микрофон</button>
              <div class="divider"></div>
              <label for="speaker" class="field-label">${icon('speaker')}Устройство воспроизведения</label>
              <select id="speaker"></select>
              <div class="volume-row"><label for="volume" class="helper">Громкость</label><output id="volume-label" for="volume">—</output></div>
              <input id="volume" type="range" min="0" max="100" step="1" aria-label="Громкость воспроизведения">
              <button type="button" id="test-speaker" class="button sound-test">${icon('speaker')}Проверить звук</button>
              <p id="audio-action" class="helper" role="status"></p>
              <p id="audio-result" class="helper" role="status"></p>
            </div>
            <h2 class="section-label">Оформление</h2>
            <div class="theme-options" role="group" aria-label="Тема оформления"><button type="button" data-theme="light">Светлая</button><button type="button" data-theme="dark">Тёмная</button><button type="button" data-theme="system">Системная</button></div>
            <div class="about"><img src="assets/sashatel-logo.svg" width="28" height="28" alt=""><div><strong>SashaTel Desktop <span id="version"></span></strong><p>Ручные исходящие звонки${isDemo ? ' · демо-сборка' : ''}</p></div></div>
          </div>
        </section>
      </main>
      <nav class="bottom-nav" aria-label="Основная навигация">
        <button type="button" data-screen="dialer" aria-current="page">${icon('phone')}<span>Телефон</span></button>
        <button type="button" data-screen="history">${icon('history')}<span>История</span></button>
        <button type="button" data-screen="settings">${icon('settings')}<span>Настройки</span></button>
      </nav>
      <footer><span>SashaTel Desktop</span><span>${isDemo ? 'Локальная демо-сессия' : 'Рабочее место оператора'}</span></footer>
    </div>`;
  /** @param {string} selector @returns {HTMLElement} */
  function get(selector) {
    const node = root.querySelector(selector);
    if (!(node instanceof HTMLElement)) throw new Error(`Missing UI element: ${selector}`);
    return node;
  }
  const phone = /** @type {HTMLInputElement} */ (get('#phone'));
  const call = /** @type {HTMLButtonElement} */ (get('#call'));
  const hangup = /** @type {HTMLButtonElement} */ (get('#hangup'));
  const erase = /** @type {HTMLButtonElement} */ (get('#erase'));
  const microphone = /** @type {HTMLSelectElement} */ (get('#microphone'));
  const speaker = /** @type {HTMLSelectElement} */ (get('#speaker'));
  const volume = /** @type {HTMLInputElement} */ (get('#volume'));
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const events = new AbortController();
  const { signal } = events;
  let previousScreen = '';
  let previousCall = false;
  let historyKey = '';
  let audioBusy = false;
  let disposed = false;
  document.documentElement.dataset.platform = window.sashatel?.platform ?? 'browser';
  get('#version').textContent = window.sashatel?.version ?? '0.1.0';
  try {
    const stored = localStorage.getItem('sashatel.theme');
    if (stored === 'light' || stored === 'dark' || stored === 'system') controller.theme = stored;
  } catch { /* Theme still works when storage is unavailable. */ }
  function applyTheme() {
    const dark = controller.theme === 'dark' || (controller.theme === 'system' && media.matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    get('#theme-toggle').innerHTML = icon(dark ? 'sun' : 'moon');
    get('#theme-toggle').setAttribute('aria-label', dark ? 'Включить светлую тему' : 'Включить тёмную тему');
    root.querySelectorAll('button[data-theme]').forEach(button => button.setAttribute('aria-pressed', String(/** @type {HTMLElement} */ (button).dataset.theme === controller.theme)));
  }
  function setTheme(/** @type {'light'|'dark'|'system'} */ theme) {
    controller.theme = theme;
    try { localStorage.setItem('sashatel.theme', theme); } catch { /* optional preference */ }
    applyTheme();
  }
  get('#theme-toggle').addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'), { signal });
  media.addEventListener('change', applyTheme, { signal });
  root.querySelectorAll('button[data-theme]').forEach(button => button.addEventListener('click', () => setTheme(/** @type {'light'|'dark'|'system'} */ (/** @type {HTMLElement} */ (button).dataset.theme)), { signal }));
  function updatePhone() {
    if (phone.value !== controller.phone) phone.value = controller.phone;
    call.disabled = !controller.phone.trim() || controller.busy || !controller.snapshot.canStart;
    erase.disabled = !controller.phone || controller.busy;
    phone.setAttribute('aria-invalid', String(Boolean(controller.error)));
    get('#ui-error').textContent = controller.error;
    get('#ui-error').hidden = !controller.error || controller.inCall;
    get('#phone-help').hidden = Boolean(controller.error) || controller.resultVisible;
    get('#last-result').hidden = !controller.resultVisible || Boolean(controller.error);
    get('#dialer-title').textContent = controller.resultVisible ? stateLabels[controller.snapshot.state] : 'Новый звонок';
  }
  phone.addEventListener('input', () => {
    const position = phone.selectionStart ?? phone.value.length;
    const prefix = sanitizePhone(phone.value.slice(0, position));
    controller.edit(phone.value); updatePhone();
    phone.setSelectionRange(prefix.length, prefix.length);
    get('#ui-error').hidden = true;
  }, { signal });
  // Reject malformed paste instead of silently turning text containing letters into a different number.
  phone.addEventListener('paste', event => {
    const raw = event.clipboardData?.getData('text') ?? '';
    if (/[^\d+()\s-]/.test(raw)) {
      event.preventDefault(); controller.error = 'Вставьте только номер: цифры, пробелы, скобки и знак +.'; render();
    }
  }, { signal });
  function insert(/** @type {string} */ text) {
    const start = phone.selectionStart ?? phone.value.length;
    const end = phone.selectionEnd ?? start;
    controller.edit(phone.value.slice(0, start) + text + phone.value.slice(end));
    updatePhone(); phone.focus();
    const position = Math.min(start + text.length, phone.value.length);
    phone.setSelectionRange(position, position);
  }
  erase.addEventListener('click', () => {
    const start = phone.selectionStart ?? phone.value.length;
    const end = phone.selectionEnd ?? start;
    if (start === end) phone.setSelectionRange(Math.max(0, start - 1), end);
    insert('');
  }, { signal });
  get('#key-erase').addEventListener('pointerdown', event => event.preventDefault(), { signal });
  get('#key-erase').addEventListener('click', () => erase.click(), { signal });
  root.querySelectorAll('button[data-digit]').forEach(button => {
    button.addEventListener('pointerdown', event => event.preventDefault(), { signal });
    button.addEventListener('click', () => insert(/** @type {HTMLElement} */ (button).dataset.digit ?? ''), { signal });
  });
  call.addEventListener('click', () => { void controller.start(); }, { signal });
  hangup.addEventListener('click', () => { void controller.end(); }, { signal });
  root.querySelectorAll('button[data-screen]').forEach(button => button.addEventListener('click', () => {
    controller.navigate(/** @type {'dialer'|'history'|'settings'} */ (/** @type {HTMLElement} */ (button).dataset.screen));
  }, { signal }));
  root.querySelectorAll('button[data-event]').forEach(button => button.addEventListener('click', () => {
    services.demo?.send(/** @type {import('./contracts').DemoEvent} */ (/** @type {HTMLElement} */ (button).dataset.event));
  }, { signal }));
  get('#refresh-history').addEventListener('click', () => { void controller.loadHistory(); }, { signal });
  get('#history-content').addEventListener('click', event => {
    const button = event.target instanceof Element ? event.target.closest('button') : null;
    if (!(button instanceof HTMLButtonElement) || button.disabled) return;
    if (button.dataset.retry) void controller.loadHistory();
    if (button.dataset.number) { controller.redial(button.dataset.number); phone.focus(); }
  }, { signal });
  document.addEventListener('keydown', event => {
    if (event.key === 'Enter' && event.target === phone && !event.repeat) { event.preventDefault(); void controller.start(); }
    if (controller.screen !== 'dialer' || controller.inCall || controller.busy || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLButtonElement) return;
    if (/^[\d+]$/.test(event.key)) { event.preventDefault(); insert(event.key); }
  }, { signal });

  function renderHistory() {
    const key = JSON.stringify([controller.history, controller.historyLoading, controller.historyError]);
    if (key === historyKey) return;
    historyKey = key;
    const container = get('#history-content'); container.replaceChildren();
    container.setAttribute('aria-busy', String(controller.historyLoading));
    if (controller.historyLoading || controller.historyError || !controller.history.length) {
      const state = document.createElement('div'); state.className = 'empty-state';
      state.innerHTML = icon(controller.historyError ? 'info' : 'history');
      const heading = document.createElement('h2');
      heading.textContent = controller.historyLoading ? 'Загружаем историю…' : controller.historyError ? 'История недоступна' : 'Пока ни одного звонка';
      const description = document.createElement('p'); description.textContent = controller.historyError || (controller.historyLoading ? 'Подождите немного.' : 'После первого вызова здесь появятся его номер, статус и длительность.');
      state.append(heading, description);
      if (controller.historyError) {
        const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'button'; retry.textContent = 'Попробовать снова';
        retry.dataset.retry = 'true'; state.append(retry);
      }
      container.append(state); return;
    }
    const list = document.createElement('ul'); list.className = 'history-list';
    for (const item of controller.history) {
      const row = document.createElement('li'); row.className = `history-row ${item.status}`;
      const direction = document.createElement('span'); direction.className = 'direction-icon'; direction.innerHTML = icon('arrow');
      const details = document.createElement('div'); details.className = 'history-details';
      const number = document.createElement('strong'); number.textContent = displayNumber(item.number);
      const status = document.createElement('span'); status.textContent = `${item.mode === 'demo' ? 'Демо · ' : ''}Исходящий · ${historyStatusLabels[item.status] ?? historyStatusLabels.unknown}`;
      const date = document.createElement('time'); date.dateTime = item.at.toISOString(); date.textContent = item.at.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      details.append(number, status, date);
      const time = document.createElement('span'); time.className = 'history-duration'; time.textContent = duration(item.durationMs); time.setAttribute('aria-label', `Длительность ${time.textContent}`);
      const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'icon-button'; retry.innerHTML = icon('phone'); retry.setAttribute('aria-label', `Набрать ${displayNumber(item.number)}`); retry.title = 'Вернуть номер в набор'; retry.disabled = !controller.snapshot.canStart;
      retry.dataset.number = item.number;
      row.append(direction, details, time, retry); list.append(row);
    }
    container.append(list);
  }
  function render() {
    const s = controller.snapshot;
    const live = controller.inCall;
    const connectionLabels = { unavailable: 'Телефония не подключена', disconnected: 'Нет подключения', connecting: 'Подключаем телефонию…', registered: 'Телефония подключена' };
    get('#connection-status').textContent = connectionLabels[isDemo ? 'unavailable' : s.connection];
    get('.connection').classList.toggle('registered', !isDemo && s.connection === 'registered');
    get('#dialer-screen').hidden = live || controller.screen !== 'dialer';
    get('#call-screen').hidden = !live;
    get('#history-screen').hidden = live || controller.screen !== 'history';
    get('#settings-screen').hidden = live || controller.screen !== 'settings';
    get('.bottom-nav').hidden = live;
    get('#operator-status').textContent = live ? 'Вызов' : controller.busy ? 'Подготовка…' : 'Свободен';
    root.querySelectorAll('button[data-screen]').forEach(button => {
      if (/** @type {HTMLElement} */ (button).dataset.screen === controller.screen) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    updatePhone();
    get('#ui-error').textContent = controller.error; get('#ui-error').hidden = !controller.error || live;
    get('#call-error').textContent = controller.error; get('#call-error').hidden = !controller.error || !live;
    const terminal = controller.resultVisible;
    const last = get('#last-result'); last.hidden = !terminal || Boolean(controller.error);
    const reason = s.reason && Object.hasOwn(reasons, s.reason) ? reasons[/** @type {keyof typeof reasons} */ (s.reason)] : '';
    last.textContent = terminal ? `${isDemo ? 'Демо · ' : ''}${reason || stateLabels[s.state] + ' · ' + duration(s.durationMs)}${!s.canStart ? ' Новый вызов пока недоступен.' : ''}` : '';
    get('#dialer-title').textContent = terminal ? stateLabels[s.state] : 'Новый звонок';
    last.classList.toggle('failed', s.state === 'failed');
    get('#call-number').textContent = displayNumber(s.number);
    get('#call-state').textContent = `${isDemo ? 'Демо · ' : ''}${stateLabels[s.state]}`;
    get('#call-timer').textContent = s.state === 'active' || s.state === 'terminating' ? duration(s.durationMs) : '—:—';
    get('#call-description').textContent = isDemo ? 'Имитация состояния · звук не передаётся' : s.state === 'active' ? 'Соединение подтверждено сервисом' : 'Длительность считается после ответа';
    get('#call-avatar').classList.toggle('connected', s.state === 'active');
    hangup.disabled = controller.ending || s.state === 'terminating';
    get('#hangup span').textContent = hangup.disabled ? 'Завершаем…' : s.state === 'active' ? 'Завершить' : 'Отменить вызов';
    root.querySelectorAll('button[data-event]').forEach(button => {
      const event = /** @type {HTMLElement} */ (button).dataset.event;
      /** @type {HTMLButtonElement} */ (button).disabled = !live || s.state === 'terminating' || (event === 'ringing' && s.state !== 'connecting') || ((event === 'connected' || event === 'rejected') && s.state === 'active');
    });
    if (controller.screen === 'history') renderHistory();
    if (previousScreen !== controller.screen || previousCall !== live) {
      get('#main').scrollTop = 0;
      // Do not move Enter focus onto Hangup: a rapid second Enter must not cancel the new call.
      if (live) get('#main').focus();
      else if (previousCall) phone.focus();
      else if (previousScreen) get('#main').focus();
      if (previousScreen === 'settings') void services.audio.stopTest().catch(() => {});
    }
    previousScreen = controller.screen; previousCall = live;
  }
  /** @param {HTMLSelectElement} select @param {readonly import('./contracts').AudioDevice[]} devices @param {string} value */
  function deviceOptions(select, devices, value) {
    const key = JSON.stringify(devices);
    if (select.dataset.options !== key) {
      select.replaceChildren();
      for (const device of devices.length ? devices : [{ id: '', label: 'Устройства недоступны' }]) {
        const option = document.createElement('option'); option.value = device.id; option.textContent = device.label; select.append(option);
      }
      select.dataset.options = key;
    }
    select.value = value;
  }
  function renderAudio() {
    const audio = services.audio.getSnapshot();
    deviceOptions(microphone, audio.inputs, audio.inputId); deviceOptions(speaker, audio.outputs, audio.outputId);
    microphone.disabled = !audio.available || !audio.inputs.length || audioBusy;
    speaker.disabled = !audio.available || !audio.outputs.length || !audio.outputSelection || audioBusy;
    volume.disabled = !audio.available || !audio.outputs.length || audioBusy;
    if (document.activeElement !== volume || volume.disabled) volume.value = String(Math.round(audio.volume * 100));
    get('#volume-label').textContent = audio.available ? `${volume.value}%` : '—';
    get('#audio-notice').textContent = audio.message; get('#audio-notice').hidden = !audio.message;
    const denied = audio.permission === 'denied' || audio.permission === 'restricted';
    get('#audio-permission').textContent = denied ? 'Доступ к микрофону запрещён. Проверьте разрешения системы.' : audio.permission === 'granted' ? 'Доступ к микрофону разрешён.' : 'Разрешение микрофона не запрашивалось.';
    const permissionButton = /** @type {HTMLButtonElement} */ (get('#request-microphone'));
    permissionButton.hidden = !audio.available || audio.permission === 'granted';
    permissionButton.disabled = audioBusy || denied;
    get('#audio-result').textContent = audio.result;
    const micTest = /** @type {HTMLButtonElement} */ (get('#test-microphone'));
    const speakerTest = /** @type {HTMLButtonElement} */ (get('#test-speaker'));
    micTest.disabled = !audio.available || !audio.inputs.length || denied || (audioBusy && audio.testing !== 'microphone');
    speakerTest.disabled = !audio.available || !audio.outputs.length || (audioBusy && audio.testing !== 'speaker');
    micTest.textContent = audio.testing === 'microphone' ? 'Остановить' : 'Проверить';
    speakerTest.innerHTML = `${icon('speaker')}${audio.testing === 'speaker' ? 'Остановить' : 'Проверить звук'}`;
    const level = audio.testing === 'microphone' ? Math.round(Math.max(0, Math.min(1, audio.level)) * 100) : 0;
    get('.meter').setAttribute('aria-valuenow', String(level));
    root.querySelectorAll('.meter i').forEach((bar, index) => bar.classList.toggle('lit', index < Math.ceil(level / 100 * 16)));
  }
  async function audioAction(/** @type {() => Promise<void>} */ action) {
    if (audioBusy) return;
    audioBusy = true; get('#audio-action').textContent = ''; renderAudio();
    try { await action(); }
    catch { if (!disposed) get('#audio-action').textContent = 'Не удалось применить настройку. Проверьте устройство и разрешения.'; }
    finally {
      // A pending permission/device operation may finish after navigating away.
      if (disposed || controller.screen !== 'settings') await services.audio.stopTest().catch(() => {});
      audioBusy = false; if (!disposed) renderAudio();
    }
  }
  microphone.addEventListener('change', () => { const id = microphone.value; void audioAction(() => services.audio.selectInput(id)); }, { signal });
  speaker.addEventListener('change', () => { const id = speaker.value; void audioAction(() => services.audio.selectOutput(id)); }, { signal });
  volume.addEventListener('input', () => { get('#volume-label').textContent = `${volume.value}%`; }, { signal });
  volume.addEventListener('change', () => { const value = Number(volume.value) / 100; void audioAction(() => services.audio.setVolume(value)); }, { signal });
  get('#request-microphone').addEventListener('click', () => { void audioAction(() => services.audio.requestPermission()); }, { signal });
  get('#test-microphone').addEventListener('click', () => {
    if (services.audio.getSnapshot().testing === 'microphone') void services.audio.stopTest().catch(() => {});
    else void audioAction(() => services.audio.testMicrophone());
  }, { signal });
  get('#test-speaker').addEventListener('click', () => {
    if (services.audio.getSnapshot().testing === 'speaker') void services.audio.stopTest().catch(() => {});
    else void audioAction(() => services.audio.testSpeaker());
  }, { signal });
  const unsubscribe = controller.subscribe(render);
  const unsubscribeAudio = services.audio.subscribe(renderAudio);
  // Rendering clock reads service-owned duration only. It never changes call state.
  const tick = window.setInterval(() => {
    if (controller.inCall) get('#call-timer').textContent = ['active', 'terminating'].includes(controller.snapshot.state) ? duration(services.calls.getSnapshot().durationMs) : '—:—';
  }, 250);
  applyTheme(); render(); renderAudio();
  return () => {
    disposed = true; events.abort(); unsubscribe(); unsubscribeAudio(); window.clearInterval(tick);
    void services.audio.stopTest().catch(() => {}); root.replaceChildren();
  };
}
