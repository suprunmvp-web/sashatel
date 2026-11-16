/* SashaTel / macOS UX prototype — deliberately does not initiate real calls.
   Interaction examples must not be mistaken for the production Electron UI. */
(()=>{'use strict';
const $=q=>document.querySelector(q), $$=q=>Array.from(document.querySelectorAll(q));
const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
const preview=$('.install-preview'),steps=$$('.install-step'),play=$('#install-play');
const title=$('#install-window-title'),stageLabel=$('#install-stage-label'),stageNote=$('#install-stage-note');
const installLabels=[
  ['01 / Download complete','Файл загружен. Перейдите к установке.'],
  ['02 / Move to Applications','Переместите приложение в папку «Программы».'],
  ['03 / Microphone permission','Системный запрос macOS. Здесь показана только визуальная модель.'],
  ['04 / Ready to call','Приложение готово. Откройте интерфейс звонилки.']
];
let installTimers=[];
function cancelInstall(){installTimers.forEach(clearTimeout);installTimers=[];}
function installStep(index,stop=true){
  if(stop)cancelInstall();
  index=Math.max(0,Math.min(3,index));
  if(!preview)return;
  preview.dataset.installState=String(index);
  steps.forEach((b,i)=>{const on=i===index;b.classList.toggle('is-current',on);b.setAttribute('aria-current',on?'step':'false');});
  if(title)title.textContent=index===3?'SashaTel — готово':'SashaTel — установка';
  if(stageLabel)stageLabel.textContent=installLabels[index][0];
  if(stageNote)stageNote.textContent=index<2?installLabels[index][1]:'';
  $('#install-permission')?.setAttribute('aria-hidden',String(index!==2));
  $('#install-ready')?.setAttribute('aria-hidden',String(index!==3));
}
steps.forEach(b=>b.addEventListener('click',()=>installStep(Number(b.dataset.installStep))));
play?.addEventListener('click',()=>{
  cancelInstall();installStep(0,false);
  const delay=reduced.matches?650:1450;
  for(let i=1;i<4;i++)installTimers.push(setTimeout(()=>installStep(i,false),i*delay));
});
$('#install-open-app')?.addEventListener('click',()=>{
  $('#desktop-phone-demo')?.scrollIntoView({behavior:reduced.matches?'instant':'smooth',block:'center'});
  window.setSashaPhonePanel?.('dial');
});

const phone=$('#softphone-window'),number=$('#phone-number');
const nav=$$('.softphone-navigation [data-phone-panel]'),panels=$$('.phone-panel[data-panel-content]');
if(!phone)return;
const defaultNumber='+7 995 123-45-67';
let state='dial',panel='dial',ringTimer=0,callTimer=0,callStart=0,elapsed=0,muted=false,held=false,dtmfOpen=false;
function visible(which){
  panels.forEach(p=>{p.hidden=p.dataset.panelContent!==which;});
}
function setPanel(next){
  if(state!=='dial'||!['dial','history','settings'].includes(next))return;
  panel=next;phone.dataset.panel=next;
  nav.forEach(b=>{let yes=b.dataset.phonePanel===next;b.classList.toggle('selected',yes);b.setAttribute('aria-selected',String(yes));});
  visible(next);
  if(next==='dial')number?.focus({preventScroll:true});
}
window.setSashaPhonePanel=setPanel;
nav.forEach(b=>b.addEventListener('click',()=>setPanel(b.dataset.phonePanel)));
$$('#phone-keypad [data-digit]').forEach(b=>b.addEventListener('click',()=>{
  if(!number)return;const digit=b.dataset.digit;
  const start=number.selectionStart??number.value.length,end=number.selectionEnd??start;
  number.value=number.value.slice(0,start)+digit+number.value.slice(end);
  number.focus();number.setSelectionRange(start+digit.length,start+digit.length);
}));
$('#phone-backspace')?.addEventListener('click',()=>{
  if(!number)return;const start=number.selectionStart??number.value.length,end=number.selectionEnd??start;
  const a=start===end?Math.max(0,start-1):start;
  number.value=number.value.slice(0,a)+number.value.slice(end);
  number.focus();number.setSelectionRange(a,a);
});
function formatSeconds(sec){const m=Math.floor(sec/60),s=sec%60;return String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');}
function stopTiming(){clearTimeout(ringTimer);clearInterval(callTimer);ringTimer=0;callTimer=0;}
function changeState(next){
  state=next;phone.dataset.callState=next;
  if(next==='dial'){phone.dataset.panel='dial';setPanel('dial');}
  else visible(next==='ringing'||next==='active'?'call':'ended');
  if(next==='active'||next==='ringing')startNeural();
  else stopNeural();
}
$('#phone-start')?.addEventListener('click',()=>{
  const value=number?.value.trim()||'';
  if(value.replace(/[^0-9]/g,'').length<6){number?.focus();return;}
  stopTiming();muted=false;held=false;elapsed=0;dtmfOpen=false;resetCallButtons();
  $('#phone-call-number').textContent=value;
  $('#phone-call-timer').textContent='00:00';
  $('#phone-call-state-label').textContent='Соединение…';
  changeState('ringing');
  ringTimer=setTimeout(()=>{
    changeState('active');callStart=Date.now();$('#phone-call-state-label').textContent='Разговор';
    callTimer=setInterval(()=>{elapsed=Math.floor((Date.now()-callStart)/1000);$('#phone-call-timer').textContent=formatSeconds(elapsed);},250);
  },reduced.matches?950:1750);
});
$('#phone-hangup')?.addEventListener('click',()=>{
  stopTiming();$('#phone-ended-time').textContent='Продолжительность '+formatSeconds(elapsed);
  changeState('ended');
});
$('#phone-another')?.addEventListener('click',()=>{stopTiming();changeState('dial');number.value=number.value||defaultNumber;});
function resetCallButtons(){
  $('#phone-mute')?.setAttribute('aria-pressed','false');$('#phone-hold')?.setAttribute('aria-pressed','false');
  const node=$('#phone-mute [data-icon]');if(node){node.dataset.icon='mic';window.renderSashaIcons?.();}
  const box=$('#phone-dtmf-overlay');if(box)box.hidden=true;
}
$('#phone-mute')?.addEventListener('click',()=>{
  muted=!muted;const b=$('#phone-mute');b.setAttribute('aria-pressed',String(muted));
  b.setAttribute('aria-label',muted?'Включить микрофон':'Выключить микрофон');
  const icon=b.querySelector('[data-icon]');icon.dataset.icon=muted?'mic-off':'mic';
  window.renderSashaIcons?.();
});
$('#phone-hold')?.addEventListener('click',()=>{
  held=!held;const b=$('#phone-hold');b.setAttribute('aria-pressed',String(held));
  b.setAttribute('aria-label',held?'Продолжить вызов':'Удержать вызов');
  $('#phone-call-state-label').textContent=held?'На удержании':state==='ringing'?'Соединение…':'Разговор';
});
const neural=$('.phone-neural');
if(neural){
  const overlay=document.createElement('div');overlay.id='phone-dtmf-overlay';overlay.className='phone-dtmf-overlay';overlay.hidden=true;
  overlay.innerHTML='<span>DTMF</span><div>'+['1','2','3','4','5','6','7','8','9','*','0','#'].map(x=>'<button type="button" aria-label="DTMF '+x+'">'+x+'</button>').join('')+'</div>';
  neural.appendChild(overlay);
}
$('#phone-in-call-dtmf')?.addEventListener('click',()=>{
  dtmfOpen=!dtmfOpen;const o=$('#phone-dtmf-overlay');if(o)o.hidden=!dtmfOpen;
});

// The one allowed audio-inspired UI treatment: a calm neural ring built from
// deterministic micro-particles, stimulated by uneven speech-like impulses.
const canvas=$('#phone-neural-canvas'),ctx=canvas?.getContext('2d',{alpha:true});
let raf=0,lastTime=0,seconds=0,activeView=true;
let seed=71433;const rand=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
const dots=Array.from({length:580},()=>({
 a:rand()*Math.PI*2,rad:0.86+rand()*.21,offset:(rand()-.5)*25,
 phase:rand()*Math.PI*2,weight:.12+rand()*.42,r:.5+rand()*.75,
 golden:rand()<.052,delay:rand()*3.5
}));
function resizeCanvas(){
  if(!canvas||!ctx)return;
  const w=Math.max(1,Math.round(canvas.clientWidth)),h=Math.max(1,Math.round(canvas.clientHeight));
  const dpr=Math.min(2,window.devicePixelRatio||1);
  canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);
  ctx.setTransform(dpr,0,0,dpr,0,0);
}
function paintNeural(t){
  if(!ctx||!canvas)return;
  const w=canvas.clientWidth,h=canvas.clientHeight;if(!w||!h)return;
  ctx.clearRect(0,0,w,h);
  const cx=w/2,cy=h/2,R=Math.min(w*.27,h*.42);
  let amp=0;
  for(let k=0;k<7;k++){const a=t*(.7+k*.13)+k*1.29;amp+=Math.max(0,Math.sin(a*3.6))*Math.max(0,Math.sin(a*1.3+k))*0.18;}
  const energy=state==='active'&&!held?Math.min(1,amp):.08;
  const halo=ctx.createRadialGradient(cx,cy,0,cx,cy,R*1.25);
  halo.addColorStop(0,'rgba(232,197,71,.015)');halo.addColorStop(.72,'rgba(232,197,71,'+(energy*.047).toFixed(3)+')');halo.addColorStop(1,'rgba(232,197,71,0)');
  ctx.fillStyle=halo;ctx.fillRect(cx-R*1.25,cy-R*1.25,R*2.5,R*2.5);
  for(let i=0;i<dots.length;i++){
    const d=dots[i],angle=d.a+Math.sin(t*.22+d.phase)*.052;
    const local=Math.sin(angle*17-t*4+d.phase)+Math.sin(angle*27+t*3.4+d.phase)*.5;
    const r=R*d.rad+d.offset*.64+Math.sin(t*.31+d.phase)*2.2+local*energy*5.5;
    const x=cx+Math.cos(angle)*r,y=cy+Math.sin(angle)*r*.76;
    const pulse=Math.max(0,Math.sin(t*(1.3+d.delay*.3)+d.phase));
    const alpha=d.weight*(.6+.4*pulse)*(d.golden?.7+energy*.5:1);
    ctx.globalAlpha=Math.max(.04,Math.min(.72,alpha));
    ctx.fillStyle=d.golden?'#e8c547':i%4===0?'#77777f':'#c3c3ca';
    ctx.fillRect(x,y,d.r,d.r);
  }
  ctx.globalAlpha=1;
}
function tick(now){
  raf=0;
  if(!activeView||document.hidden||reduced.matches||!['ringing','active'].includes(state))return;
  if(lastTime)seconds+=Math.min(.06,(now-lastTime)/1000);
  lastTime=now;paintNeural(seconds);
  raf=requestAnimationFrame(tick);
}
function startNeural(){
  stopNeural();resizeCanvas();if(reduced.matches){paintNeural(0);return;}
  activeView=true;raf=requestAnimationFrame(tick);
}
function stopNeural(){if(raf)cancelAnimationFrame(raf);raf=0;lastTime=0;}
document.addEventListener('visibilitychange',()=>{if(document.hidden){stopNeural()}else if(state==='ringing'||state==='active')startNeural()});
reduced.addEventListener?.('change',()=>{if(state==='ringing'||state==='active')startNeural()});
window.addEventListener('resize',()=>{if(state==='ringing'||state==='active')resizeCanvas()},{passive:true});
changeState('dial');installStep(0);
})();
