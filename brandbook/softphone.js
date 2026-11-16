/* SashaTel / macOS UX prototype — deliberately does not initiate real calls.
   Interaction examples must not be mistaken for the production Electron UI. */
(()=>{'use strict';
const $=q=>document.querySelector(q), $$=q=>Array.from(document.querySelectorAll(q));
const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
const phone=$('#softphone-window'), number=$('#phone-number');
const nav=$('.softphone-navigation'), navButtons=$$('[data-phone-panel]');
const panels=$$('.phone-panel[data-panel-content]');
const startButton=$('#phone-start'), endButton=$('#phone-hangup');
const connection=$('#demo-connection'), callScenario=$('#demo-call'), confirmEnd=$('#demo-end-confirm');
const callTimer=$('#phone-call-timer');
const delays=reduced.matches?{connect:320,ring:600,end:300}:{connect:650,ring:1400,end:640};
let state='dial', transition=0, clock=0, call=null;
const stateLabels={connecting:'Соединяем…',ringing:'Идут гудки…',active:'Разговор',terminating:'Завершаем звонок…'};
const connectionLabels={online:'Подключено',connecting:'Подключение',offline:'Нет соединения'};

function normalizedNumber(value){
  const cleaned=value.replace(/[\s().-]/g,'');
  if(/^\+7\d{10}$/.test(cleaned))return cleaned;
  if(/^8\d{10}$/.test(cleaned))return '+7'+cleaned.slice(1);
  return /^\d{10}$/.test(cleaned)?'+7'+cleaned:null;
}
function nationalDigits(value){
  const digits=value.replace(/\D/g,'');
  if(value.startsWith('+7')||(!value.startsWith('+')&&(digits.startsWith('8')||digits.length===11&&digits.startsWith('7'))))return digits.slice(1,11);
  return digits.slice(0,10);
}
function formatInput(){
  const raw=number.value;
  if(!raw||raw==='+'){refreshDial();return;}
  const national=nationalDigits(raw);
  const before=nationalDigits(raw.slice(0,number.selectionStart)).length;
  let formatted='+7';
  if(national)formatted+=' ('+national.slice(0,3);
  if(national.length>=3)formatted+=')';
  if(national.length>3)formatted+=' '+national.slice(3,6);
  if(national.length>6)formatted+='-'+national.slice(6,8);
  if(national.length>8)formatted+='-'+national.slice(8);
  number.value=formatted;
  let cursor=2, seen=0;
  while(cursor<formatted.length&&seen<before){
    if(/\d/.test(formatted[cursor]))seen++;
    cursor++;
  }
  number.setSelectionRange(cursor,cursor);
  refreshDial();
}
function replaceNumber(value){
  number.value=value;
  number.setSelectionRange(value.length,value.length);
  formatInput();
}
function refreshDial(){
  const invalid=number.value.length>=18&&!normalizedNumber(number.value);
  number.setAttribute('aria-invalid',String(invalid));
  startButton.disabled=state!=='dial'||connection.value!=='online'||!normalizedNumber(number.value);
  $('#phone-clear').disabled=!number.value;
  $('#phone-number-hint').textContent=connection.value!=='online'?'Ожидаем подключения телефонии':
    invalid?'Введите номер из 10 цифр или с +7 / 8':'Россия · +7';
}
function visible(which){
  panels.forEach(panel=>{panel.hidden=panel.dataset.panelContent!==which;});
}
function setPanel(panel){
  if(state!=='dial')return;
  if(panel!=='settings')stopAudioTests();
  phone.dataset.panel=panel;
  navButtons.forEach(button=>{
    const selected=button.dataset.phonePanel===panel;
    button.classList.toggle('selected',selected);
    if(selected)button.setAttribute('aria-current','page');
    else button.removeAttribute('aria-current');
  });
  visible(panel);
  if(panel==='dial')number.focus({preventScroll:true});
}
window.setSashaPhonePanel=setPanel;
navButtons.forEach(button=>button.addEventListener('click',()=>setPanel(button.dataset.phonePanel)));
number.addEventListener('input',formatInput);
number.addEventListener('keydown',event=>{
  if(event.key==='Enter'&&!event.isComposing&&!startButton.disabled)startButton.click();
});
$$('#phone-keypad [data-digit]').forEach(button=>button.addEventListener('click',()=>{
  const digit=button.dataset.digit;
  const from=number.selectionStart, to=number.selectionEnd;
  if(number.value.length-(to-from)>=number.maxLength)return;
  const changed=number.value.slice(0,from)+digit+number.value.slice(to);
  if(changed.lastIndexOf('+')>0)return;
  number.setRangeText(digit,from,to,'end');
  number.focus();
  formatInput();
}));
function eraseDigit(){
  let from=number.selectionStart;
  const to=number.selectionEnd;
  if(from===to){
    if(from<=2&&number.value.startsWith('+7')){replaceNumber('');return;}
    while(from>2&&!/\d/.test(number.value[from-1]))from--;
    if(from>0)from--;
  }
  number.setRangeText('',from,to,'end');
  formatInput();
}
$('#phone-backspace').addEventListener('click',()=>{eraseDigit();number.focus();});
number.addEventListener('beforeinput',event=>{
  if(event.inputType==='deleteContentBackward'&&number.value){
    event.preventDefault();
    eraseDigit();
  }
});
$('#phone-clear').addEventListener('click',()=>{
  number.value='';
  refreshDial();
  number.focus();
});

const numberFormat=value=>value.replace(/^(\+7)(\d{3})(\d{3})(\d{2})(\d{2})$/,'$1 $2 $3-$4-$5');
const formatSeconds=seconds=>String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');
let audioContext, ringtone;
const playingTones=new Set();
function prepareSound(){
  try{
    audioContext??=new AudioContext();
    return audioContext.resume().then(()=>true).catch(()=>false);
  }catch{return Promise.resolve(false);}
}
function tone(hz,duration,volume){
  if(audioContext?.state!=='running'||volume<=0)return;
  const now=audioContext.currentTime;
  const oscillator=audioContext.createOscillator(), gain=audioContext.createGain();
  oscillator.frequency.value=hz;
  gain.gain.setValueAtTime(.0001,now);
  gain.gain.exponentialRampToValueAtTime(Math.max(.0001,volume),now+.05);
  gain.gain.exponentialRampToValueAtTime(.0001,now+duration);
  oscillator.connect(gain);gain.connect(audioContext.destination);
  oscillator.onended=()=>{playingTones.delete(oscillator);oscillator.disconnect();gain.disconnect();};
  playingTones.add(oscillator);
  oscillator.start();oscillator.stop(now+duration+.015);
}
function stopTones(){
  clearInterval(ringtone);
  playingTones.forEach(oscillator=>oscillator.stop());
}
const demoVolume=()=>Number($('#phone-volume').value)/100;
function clearTimers(){clearTimeout(transition);clearInterval(clock);}
function changeState(next){
  if(state==='ringing'&&next!=='ringing')stopTones();
  state=next;
  phone.dataset.callState=state;
  nav.hidden=state!=='dial';
  $('#phone-availability').textContent=['dial','ended','failed'].includes(state)?'Свободен':'Занят';
  endButton.disabled=state==='terminating';
  if(state==='dial')setPanel('dial');
  else if(state==='ended'||state==='failed')visible('ended');
  else{
    visible('call');
    $('#phone-call-state-label').textContent=stateLabels[state];
  }
  if(state==='ringing'||state==='active')startNeural();
  else if(state==='connecting'){resizeCanvas();paintNeural(0);}
  else stopNeural();
  refreshDial();
}

const initialHistory=[
  {number:'+79951234567',date:Date.now()-3600000,status:'Отвечен',duration:154},
  {number:'+79031253674',date:Date.now()-7200000,status:'Без ответа',duration:null},
  {number:'+79257890323',date:Date.now()-86400000,status:'Отменён',duration:null},
  {number:'+79013455678',date:Date.now()-172800000,status:'Ошибка',duration:null},
  {number:'+79163385678',date:Date.now()-259200000,status:'Не определён',duration:null}
];
const history=[...initialHistory], historyMode=$('#demo-history'), historyList=$('#history-list'), historyStatus=$('#history-status');
const historyDate=new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
let historyRequest;
function renderHistory(loading=false){
  const mode=loading?'loading':historyMode.value;
  const status={empty:'Исходящих звонков пока нет.',error:'Не удалось загрузить историю.',loading:'Загружаем историю…'};
  historyStatus.textContent=status[mode]||'';
  $('#history-refresh').disabled=loading;
  $('#history-refresh').textContent=mode==='error'?'Повторить':'Обновить';
  historyList.replaceChildren();
  if(mode!=='records')return;
  for(const record of history){
    const row=document.createElement('li'), details=document.createElement('div'), label=document.createElement('strong');
    const meta=document.createElement('small'), result=document.createElement('small'), repeat=document.createElement('button');
    label.textContent=numberFormat(record.number);
    meta.textContent=historyDate.format(record.date);
    result.textContent=record.status+(record.duration===null?'':' · '+formatSeconds(record.duration));
    result.dataset.status=record.status;
    details.append(label,meta,result);
    repeat.type='button';repeat.textContent='Повторить';
    repeat.setAttribute('aria-label','Перенести номер '+label.textContent+' на экран набора');
    repeat.addEventListener('click',()=>{replaceNumber(record.number);setPanel('dial');refreshDial();});
    row.append(details,repeat);
    historyList.append(row);
  }
}
$('#history-refresh').addEventListener('click',()=>{
  renderHistory(true);
  historyRequest=setTimeout(()=>renderHistory(),550);
});
historyMode.addEventListener('change',()=>{clearTimeout(historyRequest);renderHistory();});

function finish(status,reason=''){
  clearTimers();
  if(!call)return;
  const duration=call.answeredAt===null?null:Math.floor(((call.stoppedAt??Date.now())-call.answeredAt)/1000);
  history.unshift({number:call.number,date:call.date,status,duration});
  call=null;
  renderHistory();
  confirmEnd.hidden=true;
  const failure=status==='Ошибка'||status==='Без ответа';
  $('#phone-result-title').textContent=failure?'Не удалось соединиться':status==='Отменён'?'Вызов отменён':'Звонок завершён';
  $('#phone-ended-time').textContent=reason||(duration===null?'':'Продолжительность '+formatSeconds(duration));
  $('#phone-result-icon').dataset.icon=failure?'phone-off':'circle-check';
  window.renderSashaIcons();
  changeState(failure?'failed':'ended');
  $('#phone-another').focus({preventScroll:true});
}
startButton.addEventListener('click',()=>{
  const value=normalizedNumber(number.value);
  if(state!=='dial'||connection.value!=='online'||!value)return;
  prepareSound();
  call={number:value,date:Date.now(),scenario:callScenario.value,answeredAt:null,stoppedAt:null};
  $('#phone-call-number').textContent=numberFormat(value);
  callTimer.textContent='00:00';
  callTimer.hidden=true;
  changeState('connecting');
  endButton.focus({preventScroll:true});
  transition=setTimeout(()=>{
    if(call.scenario==='error'){finish('Ошибка','Соединение потеряно. Проверьте телефонию и повторите вызов.');return;}
    changeState('ringing');
    const ring=()=>tone(425,.52,.042*demoVolume());
    ring();ringtone=setInterval(ring,1200);
    transition=setTimeout(()=>{
      if(call.scenario==='no-answer'){finish('Без ответа','Абонент не ответил.');return;}
      call.answeredAt=Date.now();
      callTimer.hidden=false;
      changeState('active');
      clock=setInterval(()=>{callTimer.textContent=formatSeconds(Math.floor((Date.now()-call.answeredAt)/1000));},250);
    },delays.ring);
  },delays.connect);
});
function confirmCallEnd(){finish(call.answeredAt===null?'Отменён':'Отвечен');}
endButton.addEventListener('click',()=>{
  if(!call||state==='terminating')return;
  clearTimers();
  call.stoppedAt=Date.now();
  changeState('terminating');
  if(call.scenario==='pending-end')confirmEnd.hidden=false;
  else transition=setTimeout(confirmCallEnd,delays.end);
});
confirmEnd.addEventListener('click',confirmCallEnd);
$('#phone-another').addEventListener('click',()=>changeState('dial'));
$('#demo-number').addEventListener('click',()=>{if(state==='dial'){replaceNumber(number.placeholder);setPanel('dial');refreshDial();}});
function updateConnection(){
  const label=connectionLabels[connection.value];
  phone.dataset.connection=connection.value;
  $('#phone-connection-text').textContent=label;
  $('#phone-about-connection').textContent=label;
  if(call&&state!=='terminating'&&connection.value!=='online')finish('Ошибка','Соединение потеряно.');
  refreshDial();
}
connection.addEventListener('change',updateConnection);

const audio=$('#demo-audio'), micButton=$('#audio-mic-test'), outputButton=$('#audio-output-test');
const micStatus=$('#audio-mic-status'), outputStatus=$('#audio-output-status'), meter=$('#audio-meter');
let micFrame=0, micStream, micSource, micRequest=0, micActive=false, outputTesting=false;
const micErrors={denied:'Разрешите микрофон в Системных настройках → Конфиденциальность и безопасность → Микрофон.',missing:'Микрофон не найден. Подключите устройство.',unplugged:'Гарнитура отключилась. Подключите её снова или выберите другое устройство.'};
const outputErrors={unplugged:'Гарнитура отключилась. Подключите её снова или выберите другое устройство.',unsupported:'Устройство вывода задаётся в системных настройках.'};
function stopMic(){
  micRequest++;micActive=false;cancelAnimationFrame(micFrame);
  micSource?.disconnect();micSource=null;
  micStream?.getTracks().forEach(track=>track.stop());micStream=null;
  meter.hidden=true;meter.value=0;
  micButton.textContent='Проверить микрофон';
}
function stopOutput(){if(outputTesting)stopTones();outputTesting=false;outputButton.textContent='Проверить звук';}
function stopAudioTests(){stopMic();stopOutput();}
function updateAudio(){
  stopAudioTests();
  const mode=audio.value;
  micStatus.textContent=micErrors[mode]||'';
  outputStatus.textContent=outputErrors[mode]||'';
  const missing=mode==='missing';
  $('#phone-mic').disabled=missing||mode==='unplugged';
  $('#phone-output').disabled=mode==='unsupported'||mode==='unplugged';
  micButton.disabled=Boolean(micErrors[mode]);
  outputButton.disabled=mode==='unplugged';
}
const micSelect=$('#phone-mic');
async function listMics(){
  if(!navigator.mediaDevices?.enumerateDevices)return;
  const selected=micSelect.value;
  const inputs=(await navigator.mediaDevices.enumerateDevices()).filter(device=>device.kind==='audioinput'&&device.deviceId&&device.deviceId!=='default');
  micSelect.replaceChildren(new Option('Системный микрофон',''));
  inputs.forEach((device,index)=>micSelect.add(new Option(device.label||'Микрофон '+(index+1),device.deviceId)));
  if(inputs.some(device=>device.deviceId===selected))micSelect.value=selected;
}
micSelect.addEventListener('change',()=>{stopMic();micStatus.textContent='';});
micButton.addEventListener('click',async()=>{
  if(micActive){stopMic();micStatus.textContent='';return;}
  const request=++micRequest;
  micActive=true;
  micButton.textContent='Остановить проверку';
  if(audio.value==='no-signal'){
    meter.hidden=false;meter.value=0;micStatus.textContent='Сигнал не обнаружен · тестовый сценарий';return;
  }
  micStatus.textContent='Ожидаем доступ к микрофону…';
  try{
    const sound=prepareSound();
    const deviceId=micSelect.value;
    const stream=await navigator.mediaDevices.getUserMedia({audio:deviceId?{deviceId:{exact:deviceId}}:true});
    if(request!==micRequest){stream.getTracks().forEach(track=>track.stop());return;}
    micStream=stream;
    if(!await sound)throw new Error('Audio unavailable');
    if(request!==micRequest)return;
    const analyser=audioContext.createAnalyser();
    analyser.fftSize=1024;
    micSource=audioContext.createMediaStreamSource(stream);
    micSource.connect(analyser);
    listMics().catch(()=>{});
    stream.getAudioTracks()[0]?.addEventListener('ended',()=>{if(request===micRequest){stopMic();micStatus.textContent='Микрофон отключился.';}});
    const samples=new Float32Array(analyser.fftSize);
    let peak=0, lastVoice=0;
    meter.hidden=false;
    function measure(now){
      analyser.getFloatTimeDomainData(samples);
      let square=0;
      for(const sample of samples)square+=sample*sample;
      const level=Math.min(1,Math.sqrt(square/samples.length)*6);
      peak=Math.max(level,peak*.84);
      meter.value=peak;
      if(level>.06)lastVoice=now;
      const label=lastVoice&&now-lastVoice<650?'Сигнал обнаружен':'Скажите пару слов';
      if(micStatus.textContent!==label)micStatus.textContent=label;
      micFrame=requestAnimationFrame(measure);
    }
    micFrame=requestAnimationFrame(measure);
  }catch(error){
    if(request!==micRequest)return;
    stopMic();
    micStatus.textContent=error.name==='NotAllowedError'?'Разрешите доступ к микрофону в браузере.':'Микрофон недоступен. Проверьте устройство.';
  }
});
window.addEventListener('pagehide',stopMic);
outputButton.addEventListener('click',async()=>{
  if(outputTesting){stopOutput();outputStatus.textContent='Проверка остановлена.';return;}
  outputTesting=true;
  outputButton.textContent='Остановить проверку';
  const available=await prepareSound();
  if(!outputTesting)return;
  if(!available){
    stopOutput();
    outputStatus.textContent='Не удалось воспроизвести звук.';
    return;
  }
  const volume=demoVolume();
  tone(523.25,.65,.055*volume);
  tone(659.25,.9,.038*volume);
  outputStatus.textContent=volume?'Вы услышали звук?':'Громкость установлена на ноль.';
});
audio.addEventListener('change',updateAudio);
const themeSelect=$('#phone-theme'), systemTheme=matchMedia('(prefers-color-scheme: dark)');
try{themeSelect.value=localStorage.getItem('sashatel-desktop-theme')||'system';}catch{}
function updatePhoneTheme(){
  const choice=themeSelect.value||'system';
  phone.dataset.phoneTheme=choice==='system'?(systemTheme.matches?'dark':'light'):choice;
}
themeSelect.addEventListener('change',()=>{
  try{localStorage.setItem('sashatel-desktop-theme',themeSelect.value);}catch{}
  updatePhoneTheme();
});
systemTheme.addEventListener('change',updatePhoneTheme);
updatePhoneTheme();
updateAudio();
renderHistory();
updateConnection();

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
  const energy=state==='active'?Math.min(1,amp):state==='ringing'?.27+.16*Math.sin(t*3):.08;
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
    const light=phone.dataset.phoneTheme==='light';
    ctx.fillStyle=d.golden?(light?'#765a25':'#e8c547'):i%4===0?'#77777f':light?'#55545a':'#c3c3ca';
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
changeState('dial');
})();
