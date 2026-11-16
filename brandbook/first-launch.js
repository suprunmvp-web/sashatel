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
  const ease = value => 1 - (1 - Math.min(1, Math.max(0, value))) ** 3;

  function draw(now) {
    if (!context || !width || !height) return;
    const elapsed = reduced.matches ? 3 : (now - changed) / 1000;
    const time = reduced.matches ? 0 : now / 1000;
    const compact = width < 540;
    const x0 = width * (compact ? .5 : .73);
    const y0 = height * (compact ? .28 : .5);
    const radius = Math.min(width * (compact ? .24 : .21), height * .34);
    const converge = state === 'auth' ? ease(elapsed / 1.65) : 1;
    const pulse = state === 'link' ? Math.sin(Math.min(1, elapsed / 1.5) * Math.PI) : 0;
    const energy = state === 'open' ? .47 : state === 'ready' ? .83 : .66 + pulse * .27;
    context.clearRect(0, 0, width, height);
    const glow = context.createRadialGradient(x0, y0, radius * .27, x0, y0, radius * 1.75);
    glow.addColorStop(0, 'transparent');
    glow.addColorStop(.28, `rgba(222,164,67,${.12 * energy})`);
    glow.addColorStop(.48, `rgba(149,94,40,${.18 * energy})`);
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
      const spread = 1 + (1 - converge) * dot.drift;
      const r = radius * dot.depth * wave * spread * (1 + pulse * .08);
      const projection = 1 + z * .18;
      const flutter = .8 + .2 * Math.sin(time * 2.1 + dot.pulse);
      context.globalAlpha = energy * flutter * (.27 + .65 * (z + 1) / 2);
      context.fillStyle = dot.warm ? '#f0bc61' : z > .3 ? '#fff3df' : '#a9a19d';
      context.fillRect(x0 + rx * r * projection, y0 + ry * r * projection, dot.size * projection, dot.size * projection);
    }
    context.globalAlpha = 1;
  }

  function tick(now) {
    draw(now);
    frame = requestAnimationFrame(tick);
  }
  function render() {
    cancelAnimationFrame(frame);
    if (!visible || document.hidden) return;
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
    state = next;
    changed = performance.now();
    windowView.dataset.launchState = state;
    const screen = screens.find(item => item.dataset.launchScreen === next);
    screens.forEach(item => { item.hidden = item !== screen; });
    if (focus) {
      const target = screen.querySelector('button') || screen.querySelector('h4');
      if (target.tagName !== 'BUTTON') target.tabIndex = -1;
      target.focus({ preventScroll: true });
    }
    if (next === 'link') timer = setTimeout(() => go('ready'), reduced.matches ? 180 : 1550);
    render();
  }
  const form = document.getElementById('launch-form');
  const openSignIn = () => { form.reset(); go('auth'); document.getElementById('launch-user').focus({ preventScroll: true }); };
  document.getElementById('launch-open').addEventListener('click', openSignIn);
  document.getElementById('launch-replay').addEventListener('click', openSignIn);
  form.addEventListener('submit', event => {
    event.preventDefault();
    form.reset();
    go('link');
  });
  document.getElementById('launch-example').addEventListener('click', () => { form.reset(); go('link'); });
  document.getElementById('launch-open-phone').addEventListener('click', () => {
    document.getElementById('softphone-window').scrollIntoView({ behavior: reduced.matches ? 'instant' : 'smooth', block: 'center' });
    window.setSashaPhonePanel('dial');
  });
  new ResizeObserver(size).observe(canvas);
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; render(); }).observe(canvas);
  reduced.addEventListener('change', render);
  document.addEventListener('visibilitychange', render);
})();
