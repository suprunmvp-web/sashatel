(()=>{
  'use strict';
  const reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $=(q)=>document.querySelector(q), $$=(q)=>Array.from(document.querySelectorAll(q));
  const menu=$('.mobile-menu'), mobile=$('#mobile-nav');
  menu?.addEventListener('click',()=>{const open=menu.getAttribute('aria-expanded')!=='true';menu.setAttribute('aria-expanded',String(open));mobile.hidden=!open;});
  $$('#mobile-nav a').forEach(a=>a.addEventListener('click',()=>{mobile.hidden=true;menu.setAttribute('aria-expanded','false');}));
  const toast=$('#copy-toast');let toastTimeout;
  $$('.swatch').forEach(el=>{el.tabIndex=0;el.setAttribute('role','button');el.setAttribute('aria-label','Скопировать '+el.dataset.hex);const copy=async()=>{try{await navigator.clipboard.writeText(el.dataset.hex);toast.textContent=el.dataset.hex+' скопирован';}catch{toast.textContent='Цвет: '+el.dataset.hex;}toast.classList.add('show');clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>toast.classList.remove('show'),1650);};el.addEventListener('click',copy);el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();copy();}});});
  const anchors=$$('.top-nav a'),sections=anchors.map(a=>$(a.getAttribute('href')));
  if('IntersectionObserver'in window){const ob=new IntersectionObserver(entries=>{for(let e of entries){if(e.isIntersecting){let a=anchors.find(a=>a.getAttribute('href')==='#'+e.target.id);anchors.forEach(x=>x.classList.toggle('active',x===a));}}},{rootMargin:'-27% 0px -65% 0px'});sections.filter(Boolean).forEach(s=>ob.observe(s));}
  // One time-continuous, exactly looping 48-second motion field.
  // Uses the display's native requestAnimationFrame rate: 60 fps on 60 Hz,
  // and up to 120 fps on compatible displays, subject to device capacity.
  const SashaTelParticle = (() => {
    const LOOP_SECONDS = 48;
    const TAU = Math.PI * 2;
    const stages = [];
    // Fixed, non-uniform pseudo-syllables. Circular distances make the
    // demonstration genuinely seamless at 48 seconds, without a periodic beat.
    let demoSeed = 93613;
    const demoRandom = () => ((demoSeed = (Math.imul(demoSeed, 1664525) + 1013904223) >>> 0) / 4294967296);
    const demoEvents = Array.from({ length: 138 }, (_, i) => ({
      at: (i * LOOP_SECONDS / 138 + (demoRandom() - .5) * .24 + LOOP_SECONDS) % LOOP_SECONDS,
      strength: demoRandom() < .18 ? .07 : .23 + demoRandom() * .72,
      width: .045 + demoRandom() * .17
    }));
    function demoSpeech(seconds) {
      const t = (seconds % LOOP_SECONDS + LOOP_SECONDS) % LOOP_SECONDS;
      let energy = 0;
      for (const event of demoEvents) {
        let dt = Math.abs(t - event.at);
        dt = Math.min(dt, LOOP_SECONDS - dt);
        if (dt < event.width * 3) energy += event.strength * Math.exp(-.5 * (dt / event.width) ** 2);
      }
      return clamp(energy * .82, .02, 1);
    }
    let externalLevel = 0;
    let demonstration = false;
    let analyser = null;
    let context = null;
    let source = null;
    let sampleData = null;

    const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

    function liveAudioLevel() {
      if (!analyser || !sampleData) return externalLevel;
      analyser.getByteTimeDomainData(sampleData);
      let energy = 0;
      for (let i = 0; i < sampleData.length; i++) {
        const v = (sampleData[i] - 128) / 128;
        energy += v * v;
      }
      const rms = Math.sqrt(energy / sampleData.length);
      return Math.max(externalLevel, clamp(rms * 5.5, 0, 1));
    }

    function init(canvas, opts) {
      if (!canvas) return;
      const ctx = canvas.getContext('2d', { alpha: true });
      if (!ctx) return;
      const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      const stage = opts.stage === true;
      const neutrals = ['#e6e6e9', '#c8c8cd', '#a5a5ad'];
      const graphite = ['#72727b', '#505058'];
      const yellow = ['#e8c547', '#c9a227', '#8e7426'];
      let seed = opts.seed;
      const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
      let width = 1, height = 1, dpr = 1, particles = [];
      let raf = 0, inView = true, lastTime = null;
      let elapsed = 0, smoothAudio = 0, lastAudioSample = 0, transient = 0;
      let lastSize = '';

      function build() {
        const bounds = canvas.getBoundingClientRect();
        width = Math.max(1, bounds.width);
        height = Math.max(1, bounds.height);
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        const resolution = width.toFixed(1) + 'x' + height.toFixed(1) + '@' + dpr;
        if (resolution === lastSize && particles.length) return;
        lastSize = resolution;
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const count = Math.round(opts.count * clamp(width / 1180, .50, 1));
        // Stable random samples: individual particles share one continuous field.
        particles = Array.from({ length: count }, () => {
          const pick = random();
          const color = pick < .05 ? yellow[Math.floor(random() * yellow.length)]
            : pick < .75 ? neutrals[Math.floor(random() * neutrals.length)]
            : graphite[Math.floor(random() * graphite.length)];
          return {
            x: random(),
            offset: (random() + random() + random() - 1.5) / 1.5,
            depth: random(),
            radius: .7 + random() * 1.25,
            opacity: .18 + random() * .42,
            phase: random() * TAU,
            phase2: random() * TAU,
            gold: pick < .05,
            color
          };
        });
        paint(elapsed, smoothAudio);
      }

      function paint(seconds, level, articulation = 0) {
        ctx.clearRect(0, 0, width, height);
        // Integer temporal harmonics are precisely periodic at 48 seconds.
        // This avoids the conspicuous reset of a travelling / modulo pulse.
        const phase = (seconds % LOOP_SECONDS) / LOOP_SECONDS * TAU;
        const s1 = Math.sin(phase), c1 = Math.cos(phase);
        const s2 = Math.sin(phase * 2), c2 = Math.cos(phase * 2);
        const s3 = Math.sin(phase * 3), c3 = Math.cos(phase * 3);
        const s5 = Math.sin(phase * 5);
        const baseAmp = height * (stage ? .093 : .085);
        const spread = height * (stage ? .33 : .28);
        const center = height * (stage ? .51 : .55);
        const volume = stage ? level : 0;
        // Slow, continuous flow. Audio excites local neurons, not the width
        // or silhouette of the entire field. No secondary SoundCloud waveform.
        const pulsePosition = .5 + .36 * s1 + .065 * s3;
        const pulseRadius = stage ? .135 : .16;

        for (const particle of particles) {
          const x = particle.x;
          const fade = Math.min(1, x * 8, (1 - x) * 8);
          if (fade <= 0) continue;
          const spatial = Math.sin(x * 9.2 + 1.1 + s1 * .46 + c2 * .17);
          const detail = Math.sin(x * 21.5 + 2.2 + s2 * .48 - c3 * .18) * .20;
          const ridge = (spatial + detail) * baseAmp;
          const localSpread = spread * (.58 + .23 * Math.sin(x * 6.7 + c1 * .4 + s3 * .15));
          const chaos = Math.sin(particle.phase + phase) * 2.3
            + Math.sin(particle.phase2 + 2 * phase) * 1.4
            + Math.sin(particle.phase * .4 + 3 * phase) * .45;
          // Irregular, spatially localised excitation tracks syllables and
          // their attack transients. The average envelope stays the same size.
          const neuralA = Math.sin(x * 47 + particle.phase * .8 + phase * 3);
          const neuralB = Math.sin(x * 83 - particle.phase2 + phase * 5);
          const neural = neuralA * .64 + neuralB * .36;
          const excitation = volume * (3.5 + particle.depth * 7)
            + articulation * (5 + particle.depth * 12);
          const y = center + ridge + particle.offset * localSpread
            + chaos * (stage ? 1.6 : 1)
            + (stage ? neural * excitation : 0);
          const drift = (Math.sin(particle.phase + phase) * 2.2
            + Math.sin(particle.phase2 + 2 * phase) * 1.0
            + s5 * .36) * (stage ? 1.2 : .8)
            + (stage ? neuralB * (volume * 2.8 + articulation * 6.5) : 0);
          const px = x * width + drift;
          if (y < 0 || y > height || px < 0 || px > width) continue;
          const dx = Math.abs(x - pulsePosition);
          const signal = Math.exp(-Math.pow(dx / pulseRadius, 2));
          let alpha = particle.opacity * fade * (stage ? .89 : .63);
          const localSpark = stage ? Math.max(0, neuralA * neuralB) * (volume * .6 + articulation * 1.4) : 0;
          if (particle.gold) alpha *= .76 + 1.10 * signal + localSpark * 1.9;
          else alpha *= .92 + .14 * signal + localSpark * .42;
          ctx.globalAlpha = clamp(alpha, .02, .78);
          ctx.fillStyle = particle.color;
          const radius = particle.radius * (.8 + particle.depth * .30 + localSpark * .12);
          ctx.fillRect(px, y, radius, radius);
        }
        ctx.globalAlpha = 1;
      }

      function tick(now) {
        raf = 0;
        if (!inView || document.hidden || motionQuery.matches) return;
        if (lastTime !== null) elapsed = (elapsed + Math.min((now - lastTime) / 1000, .05)) % LOOP_SECONDS;
        lastTime = now;
        const sound = demonstration && stage ? demoSpeech(elapsed) : liveAudioLevel();
        // Fast attack, slower release for individual syllables; sample-to-sample
        // onset also adds brief fine-grained neural movement.
        const attack = sound > smoothAudio ? .48 : .13;
        smoothAudio += (sound - smoothAudio) * attack;
        transient += (Math.max(0, sound - lastAudioSample) * 2.1 - transient) * .32;
        lastAudioSample = sound;
        paint(elapsed, smoothAudio, clamp(transient, 0, 1));
        raf = requestAnimationFrame(tick);
      }
      function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; lastTime = null; }
      function start() {
        stop();
        if (motionQuery.matches) { paint(0, 0); return; }
        if (inView && !document.hidden) raf = requestAnimationFrame(tick);
      }
      const observer = 'IntersectionObserver' in window
        ? new IntersectionObserver(entries => { inView = entries[0]?.isIntersecting ?? false; start(); })
        : null;
      observer?.observe(canvas);
      const resize = 'ResizeObserver' in window
        ? new ResizeObserver(() => { build(); start(); })
        : null;
      if (resize) resize.observe(canvas);
      else window.addEventListener('resize', () => { build(); start(); }, { passive: true });
      document.addEventListener('visibilitychange', start);
      motionQuery.addEventListener?.('change', start);
      build(); start();
      stages.push({ stage, paint, build });
    }

    return {
      init,
      setAudioLevel(level) { externalLevel = clamp(Number(level) || 0, 0, 1); },
      setDemo(enabled) { demonstration = Boolean(enabled); },
      get demo() { return demonstration; },
      // Pass a stream already acquired by the phone application. This API does
      // NOT request microphone permission and does not record/store audio.
      async attachAudioStream(stream) {
        if (!stream || typeof stream.getAudioTracks !== 'function') throw new TypeError('MediaStream expected');
        if (context) await context.close();
        context = new (window.AudioContext || window.webkitAudioContext)();
        source = context.createMediaStreamSource(stream);
        analyser = context.createAnalyser();
        analyser.fftSize = 512;
        sampleData = new Uint8Array(analyser.fftSize);
        source.connect(analyser);
        await context.resume();
      },
      async detachAudioStream() {
        if (source) source.disconnect();
        if (context) await context.close();
        source = null; context = null; analyser = null; sampleData = null;
        externalLevel = 0;
      }
    };
  })();

  window.SashaTelParticle = SashaTelParticle;
  SashaTelParticle.init($('#hero-particles'), { count: 2400, seed: 31, stage: false });
  SashaTelParticle.init($('#showcase-particles'), { count: 3600, seed: 96, stage: true });
  const particleDemoButton = $('#particle-demo');
  particleDemoButton?.addEventListener('click', () => {
    const enabled = !SashaTelParticle.demo;
    SashaTelParticle.setDemo(enabled);
    particleDemoButton.setAttribute('aria-pressed', String(enabled));
    particleDemoButton.textContent = enabled ? 'Остановить демо' : 'Демо реакции на голос';
  });
  const values30=[31,37,39,35,30,32,37,35,31,29,36,38,37,41,39,42,40,44,42.8,39,44,45,43,48,50,47,44,46,49,52];
  const values7=values30.slice(-7);const values90=Array.from({length:90},(_,i)=>Math.max(19,Math.min(58,28+i*.19+Math.sin(i*.27)*4+Math.sin(i*.73)*2)));
  const svg=$('#rate-chart'),grid=$('.grid-lines'),line=$('#chart-line'),fill=$('#chart-fill'),cross=$('#chart-cross'),dot=$('#chart-dot'),hit=$('#chart-hit'),tooltip=$('#chart-tooltip');let activeValues=values30;
  const X=i=>45+i*940/(activeValues.length-1),Y=v=>216-v/60*191;
  let pts=[];function render(period){activeValues=period===7?values7:period===90?values90:values30;pts=activeValues.map((v,i)=>[X(i),Y(v)]);grid.innerHTML='';for(let i=0;i<=5;i++){let y=16+i*200/5;grid.insertAdjacentHTML('beforeend',`<line x1="45" x2="985" y1="${y}" y2="${y}"></line><text x="1" y="${y+4}">${60-i*12}%</text>`);}let d=`M ${pts[0][0]} ${pts[0][1]}`;for(let i=1;i<pts.length;i++){let [x,y]=pts[i], [px,py]=pts[i-1],mid=(px+x)/2;d+=` C ${mid} ${py}, ${mid} ${y}, ${x} ${y}`;}line.setAttribute('d',d);fill.setAttribute('d',d+' L 985 216 L 45 216 Z');clearHover();}
  const days=['1','2','3','4','5','6','7'];function focus(i){i=Math.max(0,Math.min(activeValues.length-1,i));const [x,y]=pts[i];cross.setAttribute('x1',x);cross.setAttribute('x2',x);cross.style.opacity='1';dot.setAttribute('cx',x);dot.setAttribute('cy',y);dot.style.opacity='1';let p=activeValues.length===7?`${days[i]} день`:activeValues.length===90?`${i+1} день`:`${i+1} ноя`;$('#tooltip-date').textContent=p;$('#tooltip-value').textContent=activeValues[i].toLocaleString('ru-RU',{maximumFractionDigits:1})+' %';tooltip.style.left=`${x/1000*100}%`;tooltip.style.top=`${y/245*100}%`;tooltip.classList.add('show');}
  function clearHover(){cross.style.opacity='0';dot.style.opacity='0';tooltip.classList.remove('show');}
  hit.addEventListener('pointermove',e=>{const r=svg.getBoundingClientRect();const raw=(e.clientX-r.left)/r.width*1000;focus(Math.round((raw-45)/(940)*(activeValues.length-1)));});hit.addEventListener('pointerleave',clearHover);hit.addEventListener('click',e=>{const r=svg.getBoundingClientRect();const raw=(e.clientX-r.left)/r.width*1000;focus(Math.round((raw-45)/(940)*(activeValues.length-1)));});
  $$('.period-toggle button').forEach(btn=>btn.addEventListener('click',()=>{$$('.period-toggle button').forEach(el=>{const yes=el===btn;el.classList.toggle('active',yes);el.setAttribute('aria-pressed',String(yes));});render(Number(btn.dataset.period));}));render(30);
})();