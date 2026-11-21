// Shared presentation for transient feedback. Never includes account secrets.
let pending;
let active;
export function notify(message,kind="error",duration=3000){
  if(!message) return;
  if(pending) clearTimeout(pending);
  if(active) active.remove();
  const host=document.createElement("div");
  host.className="sasha-toast sasha-toast--"+(kind==="success"?"success":"error");
  host.setAttribute("role",kind==="error"?"alert":"status");
  const icon=document.createElement("span");
  icon.className="sasha-toast__icon";
  icon.setAttribute("aria-hidden","true");
  // SVG is a fixed presentation asset, not user content.
  icon.innerHTML=kind==="error"
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 4h.01"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></svg>';
  const label=document.createElement("span");
  label.className="sasha-toast__message";
  label.textContent=message;
  host.append(icon,label);
  document.body.append(host);
  active=host;
  requestAnimationFrame(()=>host.classList.add("sasha-toast--visible"));
  pending=setTimeout(()=>{
    host.classList.remove("sasha-toast--visible");
    setTimeout(()=>{if(active===host)active=null;host.remove();},180);
  },duration);
}
