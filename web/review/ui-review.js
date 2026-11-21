import {sectionUI,wireSectionUI} from './cabinet-ux.js';
import {hydrate} from './components.js';
const sections=[['statistics','Статистика','activity'],['history','История звонков','history'],['trunks','Транки','server'],['employees','Сотрудники','users'],['integrations','Интеграции','plug'],['billing','Биллинг','credit-card']];
let page='statistics',mode='client',scenario='empty',theme='light',org='ООО «Альфа»',sidebar=false,detail=null;
const sample={days:[{date:'2026-11-15',reach:25,minutes:94,attempts:112,answers:28},{date:'2026-11-16',reach:31.2,minutes:140,attempts:154,answers:48},{date:'2026-11-17',reach:27.7,minutes:102,attempts:130,answers:36},{date:'2026-11-18',reach:34.2,minutes:245,attempts:382,answers:131},{date:'2026-11-19',reach:39.1,minutes:330,attempts:279,answers:109},{date:'2026-11-20',reach:33.7,minutes:290,attempts:326,answers:110},{date:'2026-11-21',reach:42.1,minutes:180,attempts:190,answers:80}],counts:[542,110,780,80,30,31],employees:[{name:'Анна Иванова',attempts:610,answers:210},{name:'Павел Сидоров',attempts:420,answers:140},{name:'Елена Петрова',attempts:543,answers:192}],regions:[{name:'Москва',attempts:780,answers:280},{name:'Санкт-Петербург',attempts:550,answers:180},{name:'Краснодарский край',attempts:243,answers:82}]};
// Review-only sample content. This file is excluded from commercial production builds.
const demo={
 history:[
 {id:'demo-call-1',date:'21.11.2026, 15:42',employee:'Анна Иванова',phone:'+7 999 123-45-67',trunk:'Основной',duration:'02:14',status:'Дозвон'},
 {date:'21.11.2026, 15:37',employee:'Павел Сидоров',phone:'+7 921 456-77-11',trunk:'Основной',duration:'00:00',status:'Недозвон'},
 {date:'21.11.2026, 15:31',employee:'Елена Петрова',phone:'+7 918 430-22-33',trunk:'Резервный',duration:'01:48',status:'Дозвон'},
 {date:'21.11.2026, 15:19',employee:'Анна Иванова',phone:'+7 495 625-11-22',trunk:'Основной',duration:'00:00',status:'Автоответчик'}
 ],
 trunks:[
 {id:'demo-trunk-1',name:'Основной · Билайн',registration:'Зарегистрирован',ready:'Готов',numberCount:2,active:true},
 {name:'Резервный · UIS',registration:'Не зарегистрирован',ready:'Нет связи',numberCount:0,active:false}
 ],
 staff:[
 {name:'Анна Иванова',email:'anna@alpha.example',role:'Администратор',presence:'На линии'},
 {name:'Павел Сидоров',email:'pavel@alpha.example',role:'Сотрудник',presence:'В сети'},
 {name:'Елена Петрова',email:'elena@alpha.example',role:'Сотрудник',presence:'Не в сети'}
 ],
 integrations:[{type:'amoCRM'}],
 billing:{accrued:4143,paid:1000,due:3143,documents:[
 {name:'Счёт № 00128',period:'Ноябрь 2026',amount:'3 143 ₽',status:'Ожидает оплаты'},
 {name:'УПД № 00102',period:'Октябрь 2026',amount:'2 760 ₽',status:'Оплачен'}
 ]},
 call:{phone:'+7 999 123-45-67',date:'21.11.2026, 15:42',employee:'Анна Иванова',status:'Дозвон',duration:'02:14',trunk:'Основной · Билайн',callerId:'+7 999 888-22-11',provider:'Билайн',region:'Москва',country:'Россия',timezone:'Europe/Moscow',sipCode:'200',hangupReason:'Нормальное завершение',startedAt:'21.11.2026, 15:42:03',connectedAt:'21.11.2026, 15:42:17',endedAt:'21.11.2026, 15:44:31',crm:'amoCRM',summary:'Сотрудник связался с абонентом и обсудил условия сотрудничества. Абонент попросил направить информацию на электронную почту.',transcript:[{time:'00:00',speaker:'Сотрудник',text:'Здравствуйте! Удобно сейчас говорить?'},{time:'00:04',speaker:'Абонент',text:'Здравствуйте, да, слушаю.'},{time:'00:09',speaker:'Сотрудник',text:'Расскажу коротко, с каким предложением мы к вам обращаемся.'}]},
 trunkDetail:{name:'Основной · Билайн',ready:'Готов',active:true,registration:'Зарегистрирован',host:'sip.beeline.example',port:'5060',transport:'TLS',authType:'Логин / пароль',numbers:[{number:'+7 999 888-22-11',spam:'—',attempts:80,answers:27},{number:'+7 999 888-22-12',spam:'—',attempts:78,answers:25}]},
 adminData:{employees:14,minutes:186400,organizations:[
 {name:'ООО «Альфа»',inn:'7707083893',verified:true,manager:'Александр Смирнов'},
 {name:'ООО «Бета»',inn:'7810569981',verified:false,manager:'—'}
 ]}
};
const title=()=>({profile:'Профиль',security:'Безопасность',organization:'Организация'}[page])||(mode==='admin'?(page==='employees'?'Сотрудники SashaTel':'Обзор'):sections.find(s=>s[0]===page)?.[1]||'Статистика');
function reviewAction(kind){
 const actions={
  trunk:{title:'Создать SIP-транк',subtitle:'Подключение нового оператора для исходящих звонков',fields:[['Название транка','name','text','Основной'],['SIP-сервер','server','text','sip.provider.ru'],['Логин','login','text','Номер или логин'],['Пароль','password','password','Пароль SIP']]},
  invite:{title:'Пригласить сотрудника',subtitle:'Приглашение в рабочее пространство организации',fields:[['Рабочая почта','email','email','name@company.ru'],['Имя и фамилия','name','text','Имя сотрудника']]},
  integration:{title:'Подключить интеграцию',subtitle:'Связь телефонных событий с CRM',fields:[['Название интеграции','name','text','Основная CRM']]}
 };
 const cfg=actions[kind];
 if(!cfg)return;
 const fields=cfg.fields.map(([label,name,type,placeholder])=>'<label class="ux-form-field"><span>'+label+'</span><input name="'+name+'" type="'+type+'" placeholder="'+placeholder+'" autocomplete="off" required></label>').join('');
 const dialog=document.querySelector('#ux-preview-dialog');
 dialog.innerHTML='<form method="dialog" class="ux-preview-form"><div class="ux-dialog-header"><div><h2 id="ux-dialog-title">'+cfg.title+'</h2><p>'+cfg.subtitle+'</p></div><button class="ux-dialog-close" value="cancel" formnovalidate aria-label="Закрыть"><span data-icon="x"></span></button></div><div class="ux-preview-fields">'+fields+'</div><div class="ux-dialog-footer"><span>Предпросмотр интерфейса · без сохранения данных</span><button class="ux-button ux-button-secondary" value="cancel" formnovalidate>Закрыть</button></div></form>';
 hydrate(dialog);
 dialog.showModal();
}
function render(){
 document.documentElement.dataset.theme=theme;
 document.body.className='platform ux-redesign'+(sidebar?' sidebar-collapsed':'');
 const nav=mode==='client'?sections:[['overview','Обзор','layout-dashboard'],['employees','Сотрудники','users']];
 const label=mode==='admin'?'Админский кабинет':org;
 const orgs=['ООО «Альфа»','ООО «Бета»'];
 const switcher='<details class="ux-switcher ux-workspace"><summary aria-label="Сменить организацию"><span class="ux-workspace-avatar">'+(mode==='admin'?'S':org.replace(/^ООО\s*[«\"]?/, '').slice(0,1))+'</span><span class="ux-workspace-meta"><strong>'+label+'</strong><small>'+(mode==='admin'?'SashaTel · Internal':'Организация')+'</small></span><span data-icon="chevrons-up-down"></span></summary><div class="ux-switcher-menu"><div class="ux-switcher-label">ОРГАНИЗАЦИИ</div>'+orgs.map(name=>'<button data-org="'+name+'" '+(name===org&&mode==='client'?'aria-current="page"':'')+'><span class="ux-org-initial">'+name.slice(0,1)+'</span><span>'+name+'</span></button>').join('')+'<hr><div class="ux-switcher-label">SASHATEL</div><button data-admin="1"><span data-icon="shield"></span>'+(mode==='admin'?'В клиентский кабинет':'В админский кабинет')+'</button></div></details>';
 const sidebarMarkup='<aside class="sidebar"><div class="organization-head">'+switcher+'<button id="collapse" class="icon-button" title="Свернуть меню" aria-label="Свернуть меню"><span data-icon="panel-left-close"></span></button></div><nav aria-label="Основная навигация">'+nav.map(([key,name,glyph])=>'<a href="#" data-nav="'+key+'" '+(key===page?'aria-current="page"':'')+'><span data-icon="'+glyph+'"></span><span>'+name+'</span></a>').join('')+'</nav></aside>';
 const top='<header class="platform-top"><div class="ux-breadcrumb"><span>SashaTel</span><span class="ux-crumb-separator">/</span><strong>'+title()+'</strong></div><div class="top-controls"><button type="button" id="theme" class="icon-button ux-theme-toggle" title="Сменить тему" aria-label="Сменить тему"><span data-icon="'+(theme==='light'?'moon':'sun')+'"></span></button><details class="profile-menu"><summary aria-label="Профиль пользователя"><span class="ux-user-avatar">А</span><span data-icon="chevron-down"></span></summary><div><a href="#">Профиль</a><a href="#">Безопасность</a><hr><button type="button">Выйти</button></div></details></div></header>';
 const ctx={admin:mode==='admin',details:Boolean(detail),orgId:'279a66cd-c1cc-4d19-9c09-3490e9049d0a',review:true,call:detail==='call'?demo.call:null,trunk:detail==='trunk'?demo.trunkDetail:null,stats:scenario==='populated'?sample:{},history:scenario==='populated'?demo.history:[],trunks:scenario==='populated'?demo.trunks:[],employees:scenario==='populated'?demo.staff:[],integrations:scenario==='populated'?demo.integrations:[],billing:scenario==='populated'?demo.billing:{},adminData:scenario==='populated'?demo.adminData:{},account:{first_name:'Анна',last_name:'Иванова',email:'anna@alpha.example',phone:'+7 999 555-23-45'},organization:{legal_name:org,inn:'7707083893',role:'owner',verification_status:'verified'}};
 document.querySelector('#review-root').innerHTML=sidebarMarkup+'<div class="platform-body">'+top+'<main id="content"><div class="page-heading"><h1>'+title()+'</h1></div><div id="page-content">'+(sectionUI(page,ctx)||'')+'</div></main></div><dialog id="ux-preview-dialog" class="ux-preview-dialog" aria-labelledby="ux-dialog-title"></dialog><div class="ux-review-dock" role="group" aria-label="Демонстрационные данные"><span>UI review</span><button id="state" type="button" aria-label="Переключить демонстрационные данные">'+(scenario==='empty'?'Без данных':'С данными')+'</button></div>';
 document.querySelectorAll('[data-nav]').forEach(el=>el.onclick=e=>{e.preventDefault();page=el.dataset.nav;detail=null;render()});
 document.querySelectorAll('[data-org]').forEach(el=>el.onclick=()=>{org=el.dataset.org;mode='client';page='statistics';detail=null;render()});
 document.querySelector('[data-admin]').onclick=()=>{mode=mode==='admin'?'client':'admin';page=mode==='admin'?'overview':'statistics';detail=null;render()};
 document.querySelector('#state').onclick=()=>{scenario=scenario==='empty'?'populated':'empty';render()};
 document.querySelector('#theme').onclick=()=>{theme=theme==='light'?'dark':'light';render()};
 document.querySelector('#collapse').onclick=()=>{sidebar=!sidebar;render()};
 document.querySelectorAll('[data-view]').forEach(link=>link.addEventListener('click',event=>{event.preventDefault();page=link.dataset.view;detail=null;render();}));
 document.querySelectorAll('[data-action]').forEach(btn=>btn.addEventListener('click',()=>reviewAction(btn.dataset.action)));
 document.querySelectorAll('[data-ux-open]').forEach(link=>link.addEventListener('click',event=>{event.preventDefault();detail=link.dataset.uxOpen;render()}));
 document.querySelectorAll('.ux-backlink').forEach(link=>link.addEventListener('click',event=>{event.preventDefault();detail=null;render()}));
 hydrate(document.querySelector('#review-root'));wireSectionUI();
}
render();