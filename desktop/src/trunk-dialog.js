/** @type {Record<import('./trunks').TrunkStatus, string>} */
const statusLabels = {
  configuring: 'Настраивается',
  registering: 'Регистрируется',
  registered: 'Зарегистрирован · готовность к звонкам не проверена',
  ready: 'Готов по данным сервера',
  rejected: 'Регистрация отклонена',
  degraded: 'Регистрация недоступна',
};

/** @param {HTMLElement} root @param {import('./trunks').TrunkApi} api */
export function mountTrunkDialog(root, api) {
  const titlebar = root.querySelector('.titlebar');
  if (!titlebar) throw new Error('Missing Desktop titlebar');
  const launcher = document.createElement('button');
  launcher.type = 'button';
  launcher.className = 'trunk-open';
  launcher.textContent = 'Транки';
  titlebar.insertBefore(launcher, titlebar.querySelector('#theme-toggle'));

  const dialog = document.createElement('dialog');
  dialog.className = 'trunk-dialog';
  dialog.setAttribute('aria-labelledby', 'trunk-heading');
  dialog.innerHTML = `
    <header><h2 id="trunk-heading">SIP-транки</h2><button type="button" data-close>Закрыть</button></header>
    <p data-status role="status"></p>
    <p data-error role="alert" hidden></p>
    <ul aria-label="Список транков"></ul>
    <button type="button" data-refresh>Обновить статусы</button>
    <form autocomplete="off">
      <h2>Добавить UIS</h2>
      <label>Сервер<input name="registrar" value="pbx.uiscom.ru:5060" required maxlength="253"></label>
      <label>SIP-логин<input name="login" required maxlength="128" spellcheck="false"></label>
      <label>SIP-пароль<input name="password" type="password" autocomplete="off" required maxlength="256"></label>
      <button type="submit">Добавить транк</button>
    </form>`;
  root.append(dialog);
  const form = /** @type {HTMLFormElement} */ (dialog.querySelector('form'));
  const registrar = /** @type {HTMLInputElement} */ (form.elements.namedItem('registrar'));
  const login = /** @type {HTMLInputElement} */ (form.elements.namedItem('login'));
  const password = /** @type {HTMLInputElement} */ (form.elements.namedItem('password'));
  const list = /** @type {HTMLUListElement} */ (dialog.querySelector('ul'));
  const status = /** @type {HTMLElement} */ (dialog.querySelector('[data-status]'));
  const error = /** @type {HTMLElement} */ (dialog.querySelector('[data-error]'));
  const refresh = /** @type {HTMLButtonElement} */ (dialog.querySelector('[data-refresh]'));
  const close = /** @type {HTMLButtonElement} */ (dialog.querySelector('[data-close]'));
  let busy = false;
  const retryTrunk = api.retry;
  const formControls = Array.from(form.querySelectorAll('button, input'));
  let canManage = false;
  function updateForm() {
    for (const control of formControls) control.toggleAttribute('disabled', busy || !canManage);
  }
  updateForm();
  const failures = new Map([
    ['BACKEND_UNCONFIGURED', 'Сервер управления транками не настроен.'],
    ['INVALID_SESSION', 'Сессия недействительна или истекла. Требуется новая сессия.'],
    ['ACCESS_DENIED', 'У вашей учётной записи нет доступа к управлению транками.'],
    ['TRUNK_OR_ROUTE_NOT_FOUND', 'Транк или API транков недоступен на сервере.'],
    ['INVALID_TRUNK', 'Проверьте сервер, SIP-логин и пароль.'],
    ['TRUNK_CONFLICT', 'Конфликт запроса. Обновите список перед повторной отправкой.'],
    ['RATE_LIMITED', 'Слишком много запросов. Обновите список позже.'],
    ['BACKEND_UNREACHABLE', 'Сервер не ответил. Обновите список перед повторной отправкой.'],
    ['INVALID_RESPONSE', 'Сервер вернул неподдерживаемый ответ.'],
  ]);

  /** @param {() => Promise<unknown>} action @param {string} failure */
  async function run(action, failure) {
    if (busy) return;
    busy = true;
    status.textContent = 'Загрузка…';
    error.hidden = true;
    for (const control of dialog.querySelectorAll('button:not([data-close]), input')) {
      control.setAttribute('disabled', '');
    }
    try {
      await action();
      const trunks = await api.list();
      list.replaceChildren();
      for (const trunk of trunks) {
        const row = document.createElement('li');
        const name = document.createElement('strong');
        name.textContent = trunk.registrar;
        const state = document.createElement('p');
        state.textContent = statusLabels[trunk.status] ?? 'Статус неизвестен';
        row.append(name, state);
        if (retryTrunk && (trunk.status === 'rejected' || trunk.status === 'degraded')) {
          const retry = document.createElement('button');
          retry.type = 'button';
          retry.textContent = 'Повторить подключение';
          retry.onclick = () => { void run(() => retryTrunk(trunk.id), 'Не удалось повторить подключение.'); };
          row.append(retry);
        }
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = 'Удалить транк';
        remove.onclick = () => { void run(() => api.remove(trunk.id), 'Не удалось удалить транк. Обновите список.'); };
        row.append(remove);
        list.append(row);
      }
      canManage = true;
      status.textContent = trunks.length ? '' : 'Транков пока нет.';
    } catch (cause) {
      canManage = false;
      password.value = '';
      list.replaceChildren();
      status.textContent = 'Актуальные статусы недоступны.';
      error.textContent = (cause instanceof Error && failures.get(cause.message)) || failure;
      error.hidden = false;
    } finally {
      busy = false;
      for (const control of dialog.querySelectorAll('button, input')) control.removeAttribute('disabled');
      updateForm();
      if (dialog.open && document.activeElement === document.body) refresh.focus();
    }
  }

  launcher.onclick = () => {
    dialog.showModal();
    if (!busy) void run(async () => {}, 'Не удалось загрузить транки.');
  };
  close.onclick = () => dialog.close();
  dialog.addEventListener('close', () => { password.value = ''; launcher.focus(); });
  refresh.onclick = () => { void run(async () => {}, 'Не удалось загрузить транки.'); };
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (busy || !canManage) return;
    const secret = password.value;
    password.value = '';
    void run(() => api.create({
      registrar: registrar.value.trim(),
      login: login.value.trim(),
      password: secret,
      auth_mode: 'registration_credentials',
    }), 'Не удалось добавить транк. Проверьте сервер и учётные данные, затем обновите список.');
  });

  return () => {
    password.value = '';
    dialog.remove();
    launcher.remove();
  };
}
