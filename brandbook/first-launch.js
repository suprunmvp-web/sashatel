(() => {
  const windowView = document.getElementById('launch-window');
  const canvas = document.getElementById('launch-particles');
  const context = canvas.getContext('2d');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const screens = [...windowView.querySelectorAll('[data-launch-screen]')];
  const tau = Math.PI * 2;
  let seed = 44879;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const dots = Array.from({ length: 1450 }, () => ({
    azimuth: random() * tau, height: 2 * random() - 1, depth: .77 + random() * .24,
    size: .42 + random() * 1.12, pulse: random() * tau, warm: random() < .25,
    drift: .6 + random() * .8
  }));
  let frame = 0, timer = 0, visible = false, width = 0, height = 0, changed = performance.now();
  let state = 'open';
  const linkDuration = 1150;
  const phoneWindow = document.getElementById('softphone-window');
  const phoneHome = phoneWindow.parentElement;
  const scene = canvas.parentElement;
  const zoom = {open:.9,auth:1.10,link:.86,ready:2.08,handoff:13};
  let fromZoom = .32, fromOffset = 0;
  const ease = value => {
    const t = Math.min(1, Math.max(0,value));
    return t*t*(3-2*t);
  };
  function zoomAt(now) {
    const target=zoom[state]??zoom.open;
    if(reduced.matches)return target;
    return fromZoom+(target-fromZoom)*(state==='handoff'?Math.min(1,Math.max(0,(now-changed)/920))**2.4:ease((now-changed)/820));
  }

  function offsetAt(now) {
    const target=state==='ready'||state==='handoff'?.12:0;
    return reduced.matches?target:fromOffset+(target-fromOffset)*ease((now-changed)/820);
  }

  function draw(now) {
    if (!context || !width || !height) return;
    const time = reduced.matches ? 0 : now / 1000;
    const compact = width < 540;
    const scale=zoomAt(now);
    const x0=width*((compact?.5:.73)+offsetAt(now));
    const y0=height*(compact?.29:.49);
    const radius=Math.min(width*(compact?.26:.21),height*(compact?.23:.34))*scale;
    const energy=.65;
    context.clearRect(0, 0, width, height);
    const glow = context.createRadialGradient(x0, y0, radius * .27, x0, y0, radius * 1.75);
    glow.addColorStop(0, 'transparent');
    glow.addColorStop(.28, `rgba(222,164,67,${.17 * energy})`);
    glow.addColorStop(.48, `rgba(149,94,40,${.23 * energy})`);
    glow.addColorStop(1, 'transparent');
    context.fillStyle = glow;
    context.fillRect(x0-radius*2, y0-radius*2, radius*4, radius*4);
    for (const dot of dots) {
      const rotation = dot.azimuth + time * .18;
      const y = dot.height;
      const circle = Math.sqrt(1 - y * y);
      const x = Math.cos(rotation) * circle;
      const z = Math.sin(rotation) * circle;
      const rx = x * .91 - y * .42;
      const ry = x * .42 + y * .91;
      const wave = .92 + .065 * Math.sin(dot.azimuth * 8 + dot.height * 13 - time * 1.85);
      const flight=state==='handoff'&&!reduced.matches?Math.min(1,Math.max(0,(now-changed)/920))**2.4:0;
      const depthZoom=1/Math.max(.24,1-flight*(.21+.53*(z+1)/2));
      const r = radius * dot.depth * wave * depthZoom;
      const projection = 1 + z * .18;
      const flutter = .8 + .2 * Math.sin(time * 2.1 + dot.pulse);
      context.globalAlpha = energy * flutter * (.27 + .65 * (z + 1) / 2);
      context.fillStyle = dot.warm ? '#f0bc61' : z > .3 ? '#fff3df' : '#a9a19d';
      const px=x0+rx*r*projection, py=y0+ry*r*projection;
      const size=dot.size*projection*scale*depthZoom;
      if(flight>.02){
        context.strokeStyle=context.fillStyle;
        context.lineWidth=Math.max(.6,size*.38);
        context.beginPath();
        context.moveTo(px,py);
        context.lineTo(px-(px-x0)*flight*.26,py-(py-y0)*flight*.26);
        context.stroke();
      }else context.fillRect(px,py,size,size);
    }
    if(!reduced.matches){
      for(let i=0;i<73;i++){
        const dot=dots[i];
        const x=((dot.azimuth/tau+time*.043*dot.drift)%1)*width;
        const y=height*(.73+.24*(dot.height+1)/2)+6*Math.sin(time*1.4+dot.pulse);
        context.globalAlpha=.11+.16*(.5+.5*Math.sin(time+dot.pulse));
        context.fillStyle=dot.warm?'#e5b667':'#c9b9a2';
        context.fillRect(x,y,dot.size,dot.size);
      }
    }
    context.globalAlpha = 1;
  }

  function tick(now) {
    draw(now);
    frame = requestAnimationFrame(tick);
  }
  function render() {
    cancelAnimationFrame(frame);
    if (!visible || document.hidden || state==='phone') return;
    if (reduced.matches) draw(performance.now());
    else frame = requestAnimationFrame(tick);
  }
  function size() {
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    const ratio = Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context?.setTransform(ratio, 0, 0, ratio, 0, 0);
    render();
  }

  function go(next, focus = true) {
    clearTimeout(timer);
    const now=performance.now();
    fromZoom=next==='open'?.32:zoomAt(now);
    fromOffset=next==='open'?0:offsetAt(now);
    state = next;
    changed = now;
    windowView.dataset.launchState = state;
    const screen = screens.find(item => item.dataset.launchScreen === next);
    screens.forEach(item => { item.hidden = item !== screen; });
    if (focus && screen) {
      const target = screen.querySelector('input') || screen.querySelector('button') || screen.querySelector('h4');
      if (target.tagName === 'H4') target.tabIndex = -1;
      target.focus({ preventScroll: true });
    }
    if (next === 'link') timer = setTimeout(() => go('ready'), reduced.matches ? 180 : linkDuration);
    render();
  }
  const form = document.getElementById('launch-form');
  const password = document.getElementById('launch-password');
  const passwordToggle = document.getElementById('launch-password-toggle');
  function showPassword(show) {
    password.type = show ? 'text' : 'password';
    passwordToggle.querySelector('[data-icon]').dataset.icon = show ? 'eye-off' : 'eye';
    window.renderSashaIcons();
    passwordToggle.setAttribute('aria-label', show ? 'Скрыть пароль' : 'Показать пароль');
  }
  function resetForm() {
    form.reset();
    showPassword(false);
  }
  passwordToggle.addEventListener('click', () => showPassword(password.type === 'password'));
  const openSignIn = () => { resetForm(); go('auth'); };
  document.getElementById('launch-open').addEventListener('click', openSignIn);
  document.getElementById('launch-replay').addEventListener('click', () => {
    phoneHome.append(phoneWindow);
    resetForm();
    go('open');
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    resetForm();
    go('link');
  });
  document.getElementById('launch-open-phone').addEventListener('click', () => {
    go('handoff',false);
    timer=setTimeout(()=>{
      scene.append(phoneWindow);
      go('phone',false);
      window.setSashaPhonePanel('dial');
    },reduced.matches?0:920);
  });
  new ResizeObserver(size).observe(canvas);
  go('open',false);
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; render(); }).observe(canvas);
  reduced.addEventListener('change', render);
  document.addEventListener('visibilitychange', render);
})();
