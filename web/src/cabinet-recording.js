import {esc} from './components.js';

const svg = path => '<svg viewBox="0 0 24 24" aria-hidden="true">'+path+'</svg>';
const play = svg('<path d="m8 5 12 7-12 7Z"/>');
const pause = svg('<path d="M9 5v14m6-14v14"/>');
const copy = svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>');
const download = svg('<path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4"/>');
const close = svg('<path d="m6 6 12 12M18 6 6 18"/>');
const volume = svg('<path d="M4 9v6h4l5 4V5L8 9Zm13 0a5 5 0 0 1 0 6m2-9a9 9 0 0 1 0 12"/>');
const chevron = svg('<path d="m6 9 6 6 6-6"/>');
const rates = [[.75,'0,75×'],[1,'1×'],[1.25,'1,25×'],[1.5,'1,5×'],[2,'2×']];
const time = seconds => Math.floor(seconds/60)+':'+String(Math.floor(seconds%60)).padStart(2,'0');

function recordingUrl(value){
 if(!value)return '';
 try {
  const url=new URL(value,location.href);
  return url.origin===location.origin && ['https:','http:'].includes(url.protocol)?url.href:'';
 } catch {return '';}
}

export function renderRecordingButton(recording){
 const source=recordingUrl(recording?.recordingUrl);
 if(!source)return '';
 const peaks=Array.isArray(recording.recordingPeaks)?recording.recordingPeaks.slice(0,240):[];
 return '<button type="button" class="record-control record-row" aria-pressed="false" data-recording="'+esc(recording.id)+
  '" data-recording-url="'+esc(source)+'" data-recording-phone="'+esc(recording.phone)+
  '" data-recording-peaks="'+esc(JSON.stringify(peaks))+'">'+play+'Слушать</button>';
}

export function wireRecordingPlayer(root) {
 const triggers=[...root.querySelectorAll('[data-recording-url]')];
 if(!triggers.length)return;
 const dock=document.createElement('section');
 dock.className='record-dock';
 dock.setAttribute('aria-label','Плеер записи звонка');
 dock.hidden=true;
 dock.innerHTML=`<div class="record-inner">
  <div class="record-meta"><strong></strong><span id="recordStatus" role="status"></span></div>
  <div class="record-timeline"><span id="recordElapsed">0:00</span><div>
   <svg class="record-wave" viewBox="0 0 240 38" preserveAspectRatio="none" aria-hidden="true"></svg>
   <input id="recordSeek" type="range" min="0" value="0" step="0.01" aria-label="Позиция записи">
  </div><span id="recordTotal">0:00</span></div>
  <div class="record-actions">
   <button class="record-control" type="button" id="recordPlay" aria-label="Воспроизвести">${play}</button>
   <label class="record-volume">${volume}<input type="range" min="0" max="1" value="1" step=".05" aria-label="Громкость"></label>
   <div class="record-rate"><button type="button" id="recordRate" aria-label="Скорость воспроизведения" aria-expanded="false" aria-controls="recordRateMenu"><span>1×</span>${chevron}</button>
    <div id="recordRateMenu" aria-label="Скорость воспроизведения" hidden>${rates.map(([rate,label])=>'<button type="button" data-rate="'+rate+'" aria-pressed="'+(rate===1)+'">'+label+'</button>').join('')}</div></div>
   <a id="recordDownload" class="record-control" download aria-label="Скачать запись">${download}</a>
   <button class="record-control" type="button" id="recordCopy" aria-label="Копировать ID звонка">${copy}</button>
   <button class="record-control" type="button" id="recordClose" aria-label="Закрыть плеер">${close}</button>
  </div><audio preload="metadata"></audio>
 </div>`;
 root.append(dock);
 const get=id=>dock.querySelector('#'+id);
 const audio=dock.querySelector('audio'),wave=dock.querySelector('.record-wave');
 const seek=get('recordSeek'),main=get('recordPlay'),status=get('recordStatus'),rate=get('recordRate'),rateMenu=get('recordRateMenu');
 let active=null,speed=1;
 const setRow=(button,selected)=>{
  button.setAttribute('aria-pressed',String(selected));
  button.innerHTML=selected?pause+'Закрыть':play+'Слушать';
 };
 function sync(){
  if(!active)return;
  const duration=Number.isFinite(audio.duration)?audio.duration:0;
  const current=audio.currentTime||0;
  get('recordElapsed').textContent=time(current);
  get('recordTotal').textContent=time(duration);
  seek.max=duration||1;
  seek.disabled=!duration;
  seek.value=current;
  const progress=duration?current/duration:0;
  for(const [index,bar] of Array.from(wave.children).entries())bar.classList.toggle('played',index/wave.children.length<progress);
  main.innerHTML=audio.paused?play:pause;
  main.setAttribute('aria-label',audio.paused?'Воспроизвести':'Пауза');
 }
 async function resume(){
  const trigger=active;
  try {await audio.play();}
  catch {if(trigger===active)status.textContent='Не удалось воспроизвести запись.';}
 }
 function setRateOpen(open){
  rateMenu.hidden=!open;
  rate.setAttribute('aria-expanded',String(open));
  if(open)rateMenu.querySelector('[aria-pressed=true]').focus();
 }
 function closePlayer(restore=true){
  const trigger=active;
  active=null;
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  setRateOpen(false);
  dock.hidden=true;
  if(trigger){setRow(trigger,false);if(restore)trigger.focus({preventScroll:true});}
 }
 for(const trigger of triggers)trigger.onclick=()=>{
  if(trigger===active){closePlayer();return;}
  if(active)setRow(active,false);
  active=trigger;
  setRow(trigger,true);
  const {recording,recordingUrl,recordingPhone,recordingPeaks}=trigger.dataset;
  dock.querySelector('.record-meta strong').textContent=recordingPhone;
  status.textContent='';
  get('recordDownload').href=recordingUrl;
  get('recordDownload').download='call-'+recording;
  const peaks=JSON.parse(recordingPeaks);
  const step=240/Math.max(1,peaks.length);
  wave.innerHTML=peaks.map((value,index)=>{
   const height=Math.max(2,Math.min(38,Number(value)*38||0));
   return '<rect x="'+(step*index)+'" y="'+((38-height)/2)+'" width="'+(step*.64)+'" height="'+height+'" rx=".6"/>';
  }).join('');
  wave.hidden=!peaks.length;
  dock.hidden=false;
  audio.src=recordingUrl;
  audio.playbackRate=speed;
  sync();
  void resume();
 };
 main.onclick=()=>audio.paused?resume():audio.pause();
 get('recordClose').onclick=()=>closePlayer();
 audio.addEventListener('error',()=>{if(active)status.textContent='Не удалось загрузить запись.';});
 get('recordCopy').onclick=async()=>{
  try {await navigator.clipboard.writeText(active.dataset.recording);status.textContent='ID звонка скопирован';}
  catch {status.textContent='Не удалось скопировать ID.';}
 };
 rate.onclick=()=>setRateOpen(rateMenu.hidden);
 rateMenu.onkeydown=event=>{if(event.key==='Escape'){setRateOpen(false);rate.focus();}};
 rateMenu.onclick=event=>{
  const option=event.target.closest('[data-rate]');
  if(!option)return;
  audio.playbackRate=speed=Number(option.dataset.rate);
  rate.firstElementChild.textContent=option.textContent;
  for(const item of rateMenu.children)item.setAttribute('aria-pressed',String(item===option));
  setRateOpen(false);
  rate.focus();
 };
 rate.parentElement.onfocusout=event=>{
  if(event.relatedTarget&&!event.currentTarget.contains(event.relatedTarget))setRateOpen(false);
 };
 dock.querySelector('.record-volume input').oninput=event=>{audio.volume=Number(event.target.value);};
 seek.oninput=()=>{if(Number.isFinite(audio.duration))audio.currentTime=Number(seek.value);};
 wave.onclick=event=>{
  if(!Number.isFinite(audio.duration))return;
  const bounds=wave.getBoundingClientRect();
  audio.currentTime=audio.duration*Math.max(0,Math.min(1,(event.clientX-bounds.left)/bounds.width));
 };
 for(const event of ['loadedmetadata','timeupdate','play','pause','ended'])audio.addEventListener(event,sync);
 return ()=>{if(active)closePlayer(false);};
}
