import {sectionUI,wireSectionUI} from './cabinet-ux.js';
const sections=[['statistics','Статистика','◫'],['history','История звонков','◷'],['trunks','Транки','▣'],['employees','Сотрудники','♙'],['integrations','Интеграции','⇄'],['billing','Биллинг','▤']];
let page='statistics',mode='client',scenario='empty',theme='light',org='ООО «Альфа»',sidebar=false;
const sample={days:[{date:'2026-11-15',reach:25,minutes:94,attempts:112,answers:28},{date:'2026-11-16',reach:31.2,minutes:140,attempts:154,answers:48},{date:'2026-11-17',reach:27.7,minutes:102,attempts:130,answers:36},{date:'2026-11-18',reach:34.2,minutes:245,attempts:382,answers:131},{date:'2026-11-19',reach:39.1,minutes:330,attempts:279,answers:109},{date:'2026-11-20',reach:33.7,minutes:290,attempts:326,answers:110},{date:'2026-11-21',reach:42.1,minutes:180,attempts:190,answers:80}],counts:[542,110,780,80,30,31],employees:[{name:'Анна Иванова',attempts:610,answers:210},{name:'Павел Сидоров',attempts:420,answers:140},{name:'Елена Петрова',attempts:543,answers:192}],regions:[{name:'Москва',attempts:780,answers:280},{name:'Санкт-Петербург',attempts:550,answers:180},{name:'Краснодарский край',attempts:243,answers:82}]};
// Review-only sample content. This file is excluded from commercial production builds.
const demo={
 history:[
 {date:'21.11.2026, 15:42',employee:'Анна Иванова',phone:'+7 999 123-45-67',trunk:'Основной',duration:'02:14',status:'Дозвон'},
 {date:'21.11.2026, 15:37',employee:'Павел Сидоров',phone:'+7 921 456-77-11',trunk:'Основной',duration:'00:00',status:'Недозвон'},
 {date:'21.11.2026, 15:31',employee:'Елена Петрова',phone:'+7 918 430-22-33',trunk:'Резервный',duration:'01:48',status:'Дозвон'},
 {date:'21.11.2026, 15:19',employee:'Анна Иванова',phone:'+7 495 625-11-22',trunk:'Основной',duration:'00:00',status:'Автоответчик'}
 ],
 trunks:[
 {name:'Основной · Билайн',registration:'Зарегистрирован',ready:'Готов',active:true},
 {name:'Резервный · UIS',registration:'Не зарегистрирован',ready:'Нет связи',active:false}
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
 adminData:{employees:14,minutes:186400,organizations:[
 {name:'ООО «Альфа»',inn:'7707083893',verified:true,manager:'Александр Смирнов'},
 {name:'ООО «Бета»',inn:'7810569981',verified:false,manager:'—'}
 ]}
};
const title=()=>mode==='admin'?(page==='employees'?'Сотрудники SashaTel':'Обзор'):sections.find(s=>s[0]===page)?.[1]||'Статистика';
function render(){
 document.documentElement.dataset.theme=theme;
 const nav=mode==='client'?sections:[['overview','Обзор','◫'],['employees','Сотрудники','♙']];
 document.querySelector('#review-root').innerHTML='<aside class="sidebar"><div class="organization-head"><a href="#"><strong>SashaTel</strong><small>'+(mode==='client'?'Клиентский кабинет':'Внутренняя платформа')+'</small></a><button id="collapse" class="icon-button" aria-label="Свернуть меню">☷</button></div><nav aria-label="Основная навигация">'+nav.map(([key,label,glyph])=>'<a href="#" data-nav="'+key+'" '+(key===page?'aria-current="page"':'')+'><span class="ux-nav-mark">'+glyph+'</span><span>'+label+'</span></a>').join('')+'</nav><div class="sidebar-bottom"><span>Система телефонии SashaTel</span></div></aside><div class="platform-body"><header class="platform-top"><span>Рабочее пространство</span><div class="top-controls"><div class="review-controls"><button id="state" type="button">'+(scenario==='empty'?'Пустые данные':'С данными')+'</button><button id="theme" type="button" aria-label="Сменить тему">'+(theme==='light'?'Тёмная тема':'Светлая тема')+'</button></div><details class="ux-switcher"><summary><strong>'+(mode==='admin'?'Админский кабинет':org)+'</strong><span>⌄</span></summary><div class="ux-switcher-menu"><div class="ux-switcher-label">ОРГАНИЗАЦИИ</div>'+['ООО «Альфа»','ООО «Бета»'].map(name=>'<button data-org="'+name+'">'+name+'</button>').join('')+'<hr><div class="ux-switcher-label">SASHATEL</div><button data-admin="1">'+(mode==='admin'?'В клиентский кабинет':'В админский кабинет')+'</button></div></details></div></header><main id="content"><div class="page-heading"><div><h1>'+title()+'</h1></div></div><div id="page-content">'+(sectionUI(page,{admin:mode==='admin',stats:scenario==='populated'?sample:{},history:scenario==='populated'?demo.history:[],trunks:scenario==='populated'?demo.trunks:[],employees:scenario==='populated'?demo.staff:[],integrations:scenario==='populated'?demo.integrations:[],billing:scenario==='populated'?demo.billing:{},adminData:scenario==='populated'?demo.adminData:{}})||'')+'</div></main></div>';
 document.body.className='platform'+(sidebar?' sidebar-collapsed':'');
 document.querySelectorAll('[data-nav]').forEach(el=>el.onclick=e=>{e.preventDefault();page=el.dataset.nav;render()});
 document.querySelectorAll('[data-org]').forEach(el=>el.onclick=()=>{org=el.dataset.org;mode='client';page='statistics';render()});
 document.querySelector('[data-admin]').onclick=()=>{mode=mode==='admin'?'client':'admin';page=mode==='admin'?'overview':'statistics';render()};
 document.querySelector('#state').onclick=()=>{scenario=scenario==='empty'?'populated':'empty';render()};
 document.querySelector('#theme').onclick=()=>{theme=theme==='light'?'dark':'light';render()};
 document.querySelector('#collapse').onclick=()=>{sidebar=!sidebar;render()};
 wireSectionUI();
}
render();