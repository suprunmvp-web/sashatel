import {esc, icon, link} from './components.js';

export function renderAccountPage(section, account, url) {
 const navigation = '<nav class="account-tabs" aria-label="Настройки аккаунта">'+
  link(url('profile'),'Мой профиль',section==='profile')+
  link(url('security'),'Безопасность',section==='security')+'</nav>';

 if(section==='security')return navigation+`<section class="account-panel" aria-labelledby="security-heading">
  <h2 id="security-heading">Доступ к аккаунту</h2>
  <div class="account-security-row"><div><h3>Пароль</h3><p>Чтобы задать новый пароль, подтвердите почту кодом.</p></div>
   <a class="button secondary" href="/recovery/">Восстановить пароль</a>
  </div>
  <div class="account-security-row"><div><h3>Текущая сессия</h3><p>Завершите сеанс на этом устройстве.</p></div>
   <button class="button secondary" type="button" data-action="logout">Выйти из аккаунта</button>
  </div>
 </section>`;

 const fields=[
  {name:'first_name',label:'Имя',type:'text',autocomplete:'given-name'},
  {name:'last_name',label:'Фамилия',type:'text',autocomplete:'family-name'},
  {name:'email',label:'Почта',type:'email',autocomplete:'email',verified:account.email_verified===true},
  {name:'phone',label:'Телефон',type:'tel',autocomplete:'tel',verified:account.phone_verified===true}
 ];
 const readFields=fields.map(({name,label,verified})=>`<div><dt>${label}</dt><dd><span>${esc(account[name] || '—')}</span>${
  account[name]&&verified?`<span class="account-verified">${icon('circle-check')}Подтверждено</span>`:''
 }</dd></div>`).join('');
 const editFields=fields.map(({name,label,type,autocomplete})=>`<label>${label}
  <input name="${name}" type="${type}" autocomplete="${autocomplete}" value="${esc(account[name])}"${name==='email'?' required':''}>
 </label>`).join('');

 return navigation+`<section class="account-panel" aria-labelledby="profile-heading">
  <header class="account-panel-head"><h2 id="profile-heading">Личные данные</h2>
   <button class="button secondary" type="button" id="profile-edit" aria-controls="profile-form">Редактировать</button>
  </header>
  <dl id="profile-details" class="account-details">${readFields}</dl>
  <form id="profile-form" hidden>
   <div class="account-edit-fields">${editFields}</div>
   <div class="account-edit-actions"><button class="button" type="submit" disabled>Сохранить</button>
    <button class="button secondary" type="button" id="profile-cancel">Отмена</button></div>
   <p class="account-feedback" role="status" hidden></p>
  </form>
 </section>`;
}

export function wireProfileEditor(root) {
 const form=root.querySelector('#profile-form');
 if(!form)return;
 const details=root.querySelector('#profile-details');
 const edit=root.querySelector('#profile-edit');
 const cancel=root.querySelector('#profile-cancel');
 const save=form.querySelector('[type=submit]');
 const feedback=form.querySelector('.account-feedback');
 const inputs=[...form.querySelectorAll('input')];
 const clearFeedback=()=>{
  feedback.textContent='';
  feedback.hidden=true;
 };
 edit.onclick=()=>{
  clearFeedback();
  details.hidden=edit.hidden=true;
  form.hidden=false;
  inputs[0].focus();
 };
 cancel.onclick=()=>{
  form.reset();
  clearFeedback();
  save.disabled=true;
  form.hidden=true;
  details.hidden=edit.hidden=false;
  edit.focus();
 };
 form.oninput=()=>{
  save.disabled=!inputs.some(input=>input.value.trim()!==input.defaultValue.trim());
  clearFeedback();
 };
 form.onsubmit=event=>{
  event.preventDefault();
  if(save.disabled)return;
  feedback.textContent='Изменения не сохранены.';
  feedback.hidden=false;
 };
}
