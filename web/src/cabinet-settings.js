// Cabinet settings markup from the approved HTML.
export const settingsUsersMarkup = `<section id="settingsUsers" class="settings-panel" role="tabpanel" aria-labelledby="settingsUsersTab"><div class="ws-section-heading ws-members-head"><div><h2>Пользователи организации</h2></div><button class="button admin-button admin-primary" id="wsInviteOpen" data-action="invite" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Пригласить пользователя</button></div>
  <div class="admin-table-frame table-scroll" tabindex="0" role="region" aria-label="Пользователи организации"><table class="admin-table settings-users-table"><thead><tr><th>Пользователь</th><th>Email</th><th>Роль</th><th>Телефон</th><th>Email подтверждён</th><th>Дата регистрации</th><th>Действия</th></tr></thead><tbody id="wsMembersRows"><tr><td colspan="7" class="table-empty" role="status">Нет данных</td></tr></tbody></table></div></section>`;

export function renderSettingsTabs(users) {
  return `<div class="settings-tabs" role="tablist" aria-label="Настройки организации">
    <button type="button" id="settingsGeneralTab" role="tab" aria-selected="${!users}" aria-controls="settingsGeneral" ${users?'tabindex="-1"':''}>Общие</button>
    <button type="button" id="settingsUsersTab" role="tab" aria-selected="${users}" aria-controls="settingsUsers" ${!users?'tabindex="-1"':''}>Пользователи</button>
  </div>`;
}

export const clientInviteFields = `<div class="ws-dialog-fields">
  <label>Email<input id="wsMemberEmail" name="email" type="email" required placeholder="name@company.ru" autocomplete="off"></label>
  <div class="ws-role-field"><span id="wsMemberRoleLabel">Роль</span>
    <button type="button" class="manager-trigger ws-role-trigger" id="wsMemberRoleButton" aria-labelledby="wsMemberRoleLabel wsMemberRoleValue" aria-expanded="false" aria-controls="wsMemberRoleOptions">
      <span id="wsMemberRoleValue">Менеджер</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>
    </button>
    <input id="wsMemberRole" name="role" type="hidden" value="Менеджер">
    <div class="member-role-options" id="wsMemberRoleOptions" hidden>
      <button type="button" data-member-role="Менеджер" aria-pressed="true">Менеджер</button>
      <button type="button" data-member-role="Администратор" aria-pressed="false">Администратор</button>
    </div>
  </div>
</div>`;

export function wireClientInvite(form) {
  const trigger = form.querySelector('#wsMemberRoleButton');
  const text = form.querySelector('#wsMemberRoleValue');
  const list = form.querySelector('#wsMemberRoleOptions');
  const options = [...list.querySelectorAll('button')];
  function close() {
    list.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    trigger.focus();
  }
  trigger.onclick = () => {
    if (!list.hidden) { close(); return; }
    list.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    options.find(option => option.getAttribute('aria-pressed') === 'true')?.focus();
  };
  for (const option of options) option.onclick = () => {
    form.elements.role.value = option.dataset.memberRole;
    text.textContent = option.dataset.memberRole;
    for (const item of options) item.setAttribute('aria-pressed', String(item === option));
    close();
  };
  list.onkeydown = event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      options.find(option => option !== event.target)?.focus();
    }
  };
}
