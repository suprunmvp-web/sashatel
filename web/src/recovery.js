import {notify} from './notifications.js';
const root=document.querySelector('main');
import {requestResetCode,verifyResetCode,completePasswordReset} from './recovery-api.js';
let stage='email';
let email='';
let resendAt=0;
let otp='';
let resetToken=null;
let busy=false;
const esc=(s)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons={
  mail:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/>',
  key:'<circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 9-9 2 2-2.5 2.5 1 1-2.3 2.3-1-1-3 3"/>',
  success:'<circle cx="12" cy="12" r="10"/><path d="m8 12 2.5 2.5 5-5"/>'
};
const icon=name=>'<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+icons[name]+'</svg>';
function otpCells(){return '<div class="otp-field"><label class="otp-label" for="recovery-code">Код подтверждения</label><div class="otp-box"><div class="otp-cells" aria-hidden="true">'+Array.from({length:6},(_,i)=>'<span class="otp-cell" data-otp-cell="'+i+'"></span>').join('')+'</div><input id="recovery-code" class="otp-input" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" aria-label="Шестизначный код подтверждения" required value="'+esc(otp)+'"></div></div>';}
function render(){
  document.body.classList.add('auth-recovery');
  document.body.classList.add('auth-shell');
  document.body.dataset.recoveryStage=stage;
  document.documentElement.dataset.theme='dark';
  let heading='',description='',body='';
  if(stage==='email'){
    heading='Восстановление пароля';
    description='';
    body='<form novalidate class="recovery-form" id="recovery-form"><label>Почта<input type="email" name="email" autocomplete="email" placeholder="m@example.ru" required></label><button class="button" type="submit">Отправить код подтверждения</button></form>';
  }else if(stage==='code'){
    heading='Подтвердите вашу почту';
    description='Мы отправили 6-значный код на <strong class="email">'+esc(email)+'</strong>.<br>Введите его для подтверждения.';
    body='<form novalidate class="recovery-form recovery-otp-form" id="recovery-form">'+otpCells()+'<button class="button" type="submit">Подтвердить</button></form><div class="recovery-resend-line">Не получили код? <button type="button" class="verify-link" id="recovery-resend">Отправить повторно</button></div>';
  }else if(stage==='password'){
    heading='Новый пароль';
    description='Придумайте новый пароль для вашего аккаунта.';
    body='<form novalidate class="recovery-form" id="recovery-form"><label>Новый пароль<input type="password" name="password" autocomplete="new-password" placeholder="••••••••" minlength="8" required></label><label>Повторите пароль<input type="password" name="repeat" autocomplete="new-password" placeholder="••••••••" minlength="8" required></label><button class="button" type="submit">Сохранить пароль</button></form>';
  }else{
    heading='Пароль изменён';
    description='Теперь вы можете войти с новым паролем.';
    body='<a class="button recovery-success-cta" href="/login/">Вернуться ко входу</a>';
  }
  const glyph=stage==='code'?'mail':stage==='done'?'success':'key';
  root.innerHTML='<section class="recovery-screen"><div class="recovery-emblem" aria-hidden="true">'+icon(glyph)+'</div><h1 tabindex="-1">'+heading+'</h1>'+(description?'<p class="recovery-description">'+description+'</p>':'')+body+(stage==='email'?'<p class="recovery-top-link">Вспомнили пароль? <a href="/login/">Вернуться ко входу</a></p>':'')+'</section>';
  root.querySelector('h1')?.focus({preventScroll:true});
  root.querySelector('#recovery-form')?.addEventListener('submit',onSubmit);
  const codeInput=root.querySelector('#recovery-code');
  if(codeInput){
    const sync=()=>{codeInput.value=codeInput.value.replace(/\D/g,'').slice(0,6);otp=codeInput.value;
      root.querySelectorAll('.recovery-otp-form .otp-cell').forEach((cell,i)=>{
        cell.textContent=otp[i]||'';
        cell.classList.toggle('otp-cell--active',document.activeElement===codeInput&&i===Math.min(otp.length,5));
      });};
    codeInput.addEventListener('input',sync);
    codeInput.addEventListener('focus',sync);
    codeInput.addEventListener('blur',sync);
    sync();
  }
  root.querySelector('#recovery-resend')?.addEventListener('click',async()=>{
    if(Date.now()<resendAt||busy)return;
    busy=true;
    try{
      await requestResetCode(email);
      resendAt=Date.now()+60000;
      notify('Новый код отправлен','success');
    }catch(error){notify(error.message||'Не удалось отправить код.','error');}
    finally{busy=false;updateResend();}
  });
  updateResend();
}
function updateResend(){
  const resend=root.querySelector('#recovery-resend');if(!resend)return;
  const seconds=Math.max(0,Math.ceil((resendAt-Date.now())/1000));
  resend.disabled=seconds>0;
  resend.textContent=seconds?'Отправить повторно ('+seconds+')':'Отправить повторно';
}
async function onSubmit(event){
  event.preventDefault();
  if(busy)return;
  const form=event.currentTarget;
  let next=null;
  if(stage==='email'){
    const value=String(form.elements.namedItem('email')?.value||'').trim();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)){
      notify('Введите корректный адрес электронной почты.','error');return;
    }
    email=value;next='code';
  }else if(stage==='code'){
    const code=String(form.elements.namedItem('code')?.value||'').trim();
    if(!/^\d{6}$/.test(code)){notify('Введите шестизначный код подтверждения.','error');return;}
    next='password';
    otp=code;
  }else if(stage==='password'){
    const first=String(form.elements.namedItem('password')?.value||'');
    const repeated=String(form.elements.namedItem('repeat')?.value||'');
    if(first.length<8){notify('Пароль должен содержать минимум 8 символов.','error');return;}
    if(first!==repeated){notify('Пароли не совпадают.','error');return;}
    next='done';
  }else{return;}
  busy=true;
  const submit=form.querySelector('[type="submit"]');if(submit)submit.disabled=true;
  try{
    if(stage==='email'){await requestResetCode(email);resendAt=Date.now()+60000;otp='';}
    else if(stage==='code'){resetToken=await verifyResetCode(email,otp);}
    else if(stage==='password'){await completePasswordReset(email,resetToken,form.elements.namedItem('password').value);resetToken=null;}
    stage=next;
    render();
  }catch(error){notify(error.message||'Операция недоступна. Повторите позже.','error');}
  finally{busy=false;if(submit&&submit.isConnected)submit.disabled=false;}
}
setInterval(updateResend,1000);
render();
