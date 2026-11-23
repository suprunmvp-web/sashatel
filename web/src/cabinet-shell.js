import {esc, icon, link} from './components.js';

export function cabinetWorkspace({admin,org,organizations}) {
  const name = admin ? 'SashaTel' : org.legal_name;
  const displayName=name.replace(/^Индивидуальный предприниматель\s+/iu,'ИП ');
  const contents = '<span class="workspace-symbol"><img src="/assets/sashatel-symbol-transparent.svg" width="23" height="23" alt=""></span>'+
    '<span class="workspace-text"><strong>'+esc(displayName)+'</strong><small>'+
    (admin ? 'Внутренняя платформа' : 'Организация')+'</small></span>';
  const rows = organizations.map(item => {
    const active = item.id === org?.id;
    const label = item.legal_name.replace(/^Индивидуальный предприниматель\s+/iu, 'ИП ');
    return `<button type="button" class="workspace-option" data-select-org="${esc(item.id)}" data-inn="${esc(item.inn)}"${active ? ' aria-current="true"' : ''}>
      <span class="workspace-option-symbol" aria-hidden="true">${icon('building-2')}</span>
      <span class="workspace-option-label"><strong>${esc(label)}</strong><small>ИНН ${esc(item.inn)}</small></span>
      ${active ? icon('check') : ''}
    </button>`;
  }).join('');
  return `<div class="organization-head">
    <button type="button" class="workspace-control" popovertarget="workspace-picker" title="${esc(name)}" aria-label="Выбрать организацию · ${esc(name)}">${contents}${icon('chevron-down')}</button>
    <div id="workspace-picker" class="workspace-picker" popover role="group" aria-label="Выбор организации">
      <a href="/admin/" class="workspace-option workspace-admin" hidden><span class="org-avatar admin-avatar"><svg aria-hidden="true" viewbox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"></path><path d="m9 12 2 2 4-4"></path></svg></span><span class="org-label"><b>SashaTel</b><small>Админский кабинет</small></span><span><svg aria-hidden="true" viewbox="0 0 24 24"><path d="M5 12h14m-6-6 6 6-6 6"></path></svg></span></a>
      <hr class="workspace-admin-divider" hidden>
      <label class="workspace-search"><svg aria-hidden="true" viewbox="0 0 24 24"><circle cx="10.8" cy="10.8" r="6.8"></circle><path d="m16 16 5 5"></path></svg><input aria-label="Поиск организаций" autocomplete="off" id="orgSearch" placeholder="Название или ИНН" type="search"/></label>
      <div class="workspace-results">${rows}</div>
      <p class="workspace-no-results"${rows ? ' hidden' : ''}>Организации не найдены</p>
    </div>
  </div>`;
}

const referenceNavIcons = {
  statistics: `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 19v-6M9 19V7M14 19v-9M19 19V4M3 21h18"></path></svg>`,
  trunks: `<svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="4.5" cy="6.5" fill="currentColor" r="1" stroke="none"></circle><circle cx="4.5" cy="12" fill="currentColor" r="1" stroke="none"></circle><circle cx="4.5" cy="17.5" fill="currentColor" r="1" stroke="none"></circle><path d="M9 6.5h11M9 12h11M9 17.5h11"></path></svg>`,
  history: `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3.5 9A8.5 8.5 0 1 1 4 16M3.5 4.5V9H8M12 7.5V12l3 2"/></svg>`,
  integrations: `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M9 4v5M15 4v5M7 9h10v4a5 5 0 0 1-10 0V9zM12 18v3M5 9h14"></path></svg>`,
  billing: `<svg aria-hidden="true" viewBox="0 0 24 24"><rect height="14" rx="2.5" width="18" x="3" y="5"></rect><path d="M3 10h18"></path></svg>`,
  organization: `<svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.85 2.85-.06-.06a1.7 1.7 0 0 0-1.89-.34 1.7 1.7 0 0 0-1 1.56V22h-4v-1.05A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.85-2.85.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H2v-4h1.05A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.33-1.88l-.06-.06 2.85-2.85.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V2h4v1.05A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.88-.33l.06-.06 2.85 2.85-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.55 1H22v4h-1.05A1.7 1.7 0 0 0 19.4 15Z"></path></svg>`,
  support: `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5 9 9 0 0 1-4-.95L3 21l1.5-5.2A8.5 8.5 0 1 1 21 11.5Z"></path></svg>`,
  documentation: `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 20.5a6 6 0 0 0-5-2H3V4h4a6 6 0 0 1 5 2 6 6 0 0 1 5-2h4v14.5h-4a6 6 0 0 0-5 2ZM12 6v14.5"></path></svg>`,
};

export function cabinetNavigation({admin,nav,current,url}) {
  const groups = admin ? [['Рабочее пространство',nav]] : [
    ['Главное',nav.slice(0,4)], ['Финансы',nav.slice(4,5)], ['Помощь и настройки',nav.slice(5)]
  ];
  return '<nav aria-label="Основная навигация">'+groups.map(([label,items])=>
    '<div class="cabinet-nav-group'+(label==='Помощь и настройки'?' cabinet-utility':'')+'"><div class="cabinet-nav-label">'+label+'</div>'+
    items.map(([id,glyph,text])=>link(url(id),(referenceNavIcons[id]||icon(glyph))+'<span class="cabinet-nav-text">'+text+'</span>',current===id)
      .replace('<a ','<a aria-label="'+text+'" title="'+text+'" ')).join('')+'</div>'
  ).join('')+'</nav>';
}

export function verificationNotice(status) {
  if(status==='verified')return '';
  const rejected=status==='rejected';
  return '<section class="cabinet-notice" role="status">'+icon('shield-off')+
    '<strong>'+(rejected?'Верификация отклонена':'Требуется верификация')+'</strong>'+
    '<p>'+(rejected?'Обратитесь в поддержку, чтобы уточнить причину.':'Организация не верифицирована · телефония выключена')+'</p></section>';
}

export function cabinetFinance() {
  return `<dl class="cabinet-finance" aria-label="Финансы организации">
    <div><dt>Текущий расход</dt><dd aria-label="Данных нет">—</dd></div>
    <div><dt>Следующая оплата</dt><dd aria-label="Данных нет">—</dd></div>
  </dl>`;
}

export function cabinetProfile({account,org,url,internalRole}){
  const fullName=[account?.first_name,account?.last_name].filter(Boolean).join(' ')||'Аккаунт';
  const initials=fullName.split(/\s+/).slice(0,2).map(part=>part[0]).join('').toUpperCase();
  const role=internalRole ? {admin:'Администратор',reviewer:'Проверяющий'}[internalRole] : {owner:'Владелец',admin:'Администратор',employee:'Сотрудник'}[org?.role];
  return `<div class="cabinet-profile">
    <button type="button" class="profile-trigger" popovertarget="profile-picker" aria-label="Меню профиля">
      <span class="profile-initials" aria-hidden="true">${esc(initials)}</span>
      <span class="profile-identity"><strong>${esc(fullName)}</strong>${role ? '<small>'+role+'</small>' : ''}</span>
      ${icon('ellipsis')}
    </button>
    <div class="profile-picker" id="profile-picker" popover role="group" aria-label="Профиль">
      ${org || internalRole ? link(url('profile'), `<svg aria-hidden="true" viewbox="0 0 24 24"><circle cx="12" cy="8" r="4"></circle><path d="M4 21a8 8 0 0 1 16 0"></path></svg>Мой профиль`)+link(url('security'), `<svg aria-hidden="true" viewbox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"></path><path d="m9 12 2 2 4-4"></path></svg>Безопасность`)+'<hr>' : ''}
      <button type="button" class="text-button" data-action="logout"><svg aria-hidden="true" viewbox="0 0 24 24"><path d="M10 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5M13 8l4 4-4 4m4-4H8"></path></svg>Выйти из аккаунта</button>
    </div>
  </div>`;
}

export function showCabinetWelcome({account, org, organizationUrl, openTrunk}) {
  try {
    if (sessionStorage.getItem('sashatel.web.welcome') !== org.id) return;
    sessionStorage.removeItem('sashatel.web.welcome');
  } catch { return; }

  const dialog = document.createElement('dialog');
  dialog.className = 'cabinet-welcome';
  dialog.setAttribute('aria-labelledby', 'cabinet-welcome-title');
  dialog.setAttribute('aria-describedby', 'cabinet-welcome-copy');
  const name = account.first_name?.trim();
  const verified = org.verification_status === 'verified';
  dialog.innerHTML = `
    <form method="dialog"><button class="icon-button welcome-close" aria-label="Закрыть приветствие"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></form>
    <div class="welcome-pattern" aria-hidden="true"><span>👋　✦　💬　♡　☎️</span><span>🎧</span><span>💬</span><span>✧　☎️　♡　🎧　👋</span></div>
    <h2 id="cabinet-welcome-title" tabindex="-1" autofocus><span>Добро пожаловать${name ? ',' : '!'}</span>${name ? ' <em>'+esc(name)+'!</em>' : ''}</h2>
    <p id="cabinet-welcome-copy">Рады вас видеть в платформе SashaTel. Мы ценим, что вы доверили нам увеличение ваших конверсий, обещаем сделать все возможное, чтобы это стало <span class="welcome-signoff">реальностью<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.1-4.4-9.2-8.9C.9 8.2 3.3 4.4 7 4.4c2 0 3.8 1.1 5 2.8 1.2-1.7 3-2.8 5-2.8 3.7 0 6.1 3.8 4.2 7.7C19.1 16.6 12 21 12 21Z"/></svg></span></p>
    ${verified ? '<button class="button welcome-action" type="button">Подключить транк</button>' : '<a class="button welcome-action" href="'+esc(organizationUrl)+'">К верификации</a>'}`;
  const heading = dialog.querySelector('h2');
  const title = heading.textContent;
  heading.setAttribute('aria-label', title);
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    let index = 0;
    for (const segment of heading.children) {
      const letters = Array.from(segment.textContent, character => {
        const letter = document.createElement('span');
        letter.textContent = character;
        letter.animate([{opacity: 0}, {opacity: 1}], {
          duration: 180, delay: 100 + index++ * 30, fill: 'backwards',
        });
        return letter;
      });
      segment.setAttribute('aria-hidden', 'true');
      segment.replaceChildren(...letters);
    }
  }
  dialog.addEventListener('close', () => dialog.remove(), {once: true});
  dialog.querySelector('.welcome-action').addEventListener('click', () => {
    dialog.close();
    if (verified) openTrunk();
  });
  document.body.append(dialog);
  dialog.showModal();
}
