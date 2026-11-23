import {esc, icon, link} from './components.js';

export function cabinetWorkspace({admin,org}) {
  const name = admin ? 'SashaTel' : org.legal_name;
  const displayName=name.replace(/^Индивидуальный предприниматель\s+/iu,'ИП ');
  const contents = '<span class="workspace-symbol"><img src="/assets/sashatel-symbol-transparent.svg" width="23" height="23" alt=""></span>'+
    '<span class="workspace-text"><strong>'+esc(displayName)+'</strong><small>'+
    (admin ? 'Внутренняя платформа' : 'Организация')+'</small></span>';
  return '<div class="organization-head">'+(admin
    ? '<div class="workspace-control">'+contents+'</div>'
    : '<button type="button" class="workspace-control" data-action="organizations" title="'+esc(name)+'" aria-label="Выбрать организацию · '+esc(name)+'" aria-haspopup="dialog">'+contents+icon('chevron-down')+'</button>')+'</div>';
}

export function cabinetNavigation({admin,nav,current,url}) {
  const groups = admin ? [['Платформа',nav]] : [
    ['Главное',nav.slice(0,4)], ['Финансы',nav.slice(4,5)], ['Помощь и настройки',nav.slice(5)]
  ];
  return '<nav aria-label="Основная навигация">'+groups.map(([label,items])=>
    '<div class="cabinet-nav-group"><div class="cabinet-nav-label">'+label+'</div>'+
    items.map(([id,glyph,text])=>link(url(id),icon(glyph)+'<span>'+text+'</span>',current===id)
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

export function cabinetProfile({account,org,url}){
  const fullName=[account?.first_name,account?.last_name].filter(Boolean).join(' ')||'Аккаунт';
  const initials=fullName.split(/\s+/).slice(0,2).map(part=>part[0]).join('').toUpperCase();
  const role={owner:'Владелец',admin:'Администратор',employee:'Сотрудник'}[org?.role];
  return '<details class="profile-menu cabinet-profile"><summary><span class="profile-initials" aria-hidden="true">'+esc(initials)+'</span>'+
    '<span class="profile-identity"><strong>'+esc(fullName)+'</strong>'+(role?'<small>'+role+'</small>':'')+'</span>'+
    icon('ellipsis')+'</summary><div>'+(org?link(url('profile'),'Профиль')+link(url('security'),'Безопасность')+link(url('organization'),'Организация'):'')+
    '<button type="button" class="text-button" data-action="logout">Выйти</button></div></details>';
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
