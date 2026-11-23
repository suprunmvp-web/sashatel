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
    ['Главное',nav.slice(0,4)], ['Финансы',nav.slice(4,5)], ['Настройки',nav.slice(5)]
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
  return '<section class="cabinet-notice" role="status">'+'<span data-icon aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m12 2 7 3v6c0 5-3 8-7 10-4-2-7-5-7-10V5l7-3Zm0 6v4m0 4h.01"/></svg></span>'+
    '<strong>'+(rejected?'Верификация отклонена':'Требуется верификация')+'</strong>'+
    '<p>'+(rejected?'Обратитесь в поддержку, чтобы уточнить причину.':'Организация не верифицирована · телефония выключена')+'</p></section>';
}
