const chartBounds={left:56,right:986,top:14,bottom:212,width:1000,height:250};
const formatNumber=new Intl.NumberFormat('ru-RU');
const formatPercent=new Intl.NumberFormat('ru-RU',{style:'percent',maximumFractionDigits:1});
const formatDay=new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'short',timeZone:'UTC'});
const formatDate=new Intl.DateTimeFormat('ru-RU',{dateStyle:'long',timeZone:'UTC'});
const svgNS='http://www.w3.org/2000/svg';

function wireOutcomes(root){
 const svg=root.querySelector('#outcomeDonut');
 if(!svg)return;
 const slices=[...root.querySelectorAll('.outcomes-content [data-slice]')];
 let focused=null, hovered=null;
 const update=()=>{
  const index=hovered??focused;
  svg.classList.toggle('has-focus',index!=null);
  for(const slice of slices)slice.classList.toggle('is-focused',slice.dataset.slice===index);
 };
 for(const slice of slices){
  slice.addEventListener('pointerenter',()=>{hovered=slice.dataset.slice;update();});
  slice.addEventListener('pointerleave',()=>{hovered=null;update();});
  slice.addEventListener('focus',()=>{focused=slice.dataset.slice;update();});
  slice.addEventListener('blur',()=>{focused=null;update();});
 }
}

export function wireStatisticsChart(root){
 wireOutcomes(root);
 const chart=root.querySelector('#reachChart[data-days]');
 if(!chart)return;
 const days=JSON.parse(chart.dataset.days);
 const {left,right,top,bottom,width,height}=chartBounds;
 const points=days.map((day,index)=>{
  const reach=day.attempts?day.answers/day.attempts:0;
  const x=days.length===1?(left+right)/2:left+index*(right-left)/(days.length-1);
  return {...day,reach,x,y:bottom-Math.min(.6,reach)/.6*(bottom-top)};
 });
 const svg=chart.querySelector('svg');
 const marker=chart.querySelector('#graphHoverMarker');
 const tip=chart.querySelector('#graphTooltip');
 const dates=root.querySelector('#graphDates');
 const dateAnnouncement=root.querySelector('#graphAnnouncement');
 const path=points.map(({x,y},index)=>(index?'L':'M')+x.toFixed(2)+' '+y.toFixed(2)).join(' ');
 root.querySelector('#graphLine').setAttribute('d',path);
 root.querySelector('#graphArea').setAttribute('d',path+' L'+points.at(-1).x+' '+bottom+' L'+points[0].x+' '+bottom+' Z');
 if(points.length===1){
  const point=document.createElementNS(svgNS,'circle');
  point.setAttribute('cx',String(points[0].x));
  point.setAttribute('cy',String(points[0].y));
  point.setAttribute('r','4');
  point.setAttribute('class','graph-single-point');
  svg.append(point);
 }
 const tickCount=Math.min(6,points.length);
 for(let tick=0;tick<tickCount;tick++){
  const {date,x}=points[tickCount===1?0:Math.round(tick*(points.length-1)/(tickCount-1))];
  const label=document.createElement('span');
  label.style.left=(x/width*100)+'%';
  label.textContent=formatDay.format(new Date(date));
  dates.append(label);
 }
 let index=-1;
 function showDay(next,announce=false){
  const selected=Math.max(0,Math.min(points.length-1,next));
  if(selected===index&&!announce)return;
  index=selected;
  const {date,x,y,reach,minutes,attempts,answers}=points[index];
  const pointX=x/width*svg.clientWidth,pointY=y/height*svg.clientHeight;
  const dateLabel=formatDate.format(new Date(date));
  const percent=formatPercent.format(reach);
  marker.style.left=pointX+'px';
  marker.style.top=pointY+'px';
  marker.hidden=false;
  tip.querySelector('.tip-date').textContent=dateLabel;
  tip.querySelector('.tip-reach strong').textContent=percent;
  const values=[minutes,attempts,answers];
  tip.querySelectorAll('.tip-details b').forEach((value,i)=>{value.textContent=formatNumber.format(values[i]);});
  tip.hidden=false;
  const tipLeft=pointX>svg.clientWidth/2?pointX-tip.offsetWidth-22:pointX+22;
  tip.style.left=Math.max(6,Math.min(chart.clientWidth-tip.offsetWidth-6,tipLeft))+'px';
  tip.style.top=Math.max(6,Math.min(chart.clientHeight-tip.offsetHeight-6,pointY-tip.offsetHeight/2))+'px';
  if(announce)dateAnnouncement.textContent=dateLabel+' · дозвон '+percent+' · попыток '+formatNumber.format(attempts)+' · ответов '+formatNumber.format(answers);
 }
 function hideDay(){
  index=-1;
  marker.hidden=true;
  tip.hidden=true;
  dateAnnouncement.textContent='';
 }
 function pointerDay(event){
  const rect=svg.getBoundingClientRect();
  if(!rect.width)return;
  const fraction=((event.clientX-rect.left)/rect.width*width-left)/(right-left);
  showDay(Math.round(fraction*(points.length-1)));
 }
 chart.onpointermove=event=>{if(event.pointerType!=='touch')pointerDay(event);};
 chart.onpointerleave=hideDay;
 chart.onclick=pointerDay;
 chart.onblur=hideDay;
 chart.onkeydown=event=>{
  const keys={ArrowLeft:index-1,ArrowRight:index+1,Home:0,End:points.length-1};
  if(event.key==='Escape'){hideDay();return;}
  if(!Object.hasOwn(keys,event.key))return;
  event.preventDefault();
  showDay(keys[event.key],true);
 };
}
