const canvas = document.querySelector("#particles");
const ctx = canvas.getContext("2d");
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
let width = 0,
  height = 0,
  frame = 0,
  last = 0;
function resize() {
  const ratio = Math.min(devicePixelRatio, 2);
  width = innerWidth;
  height = innerHeight;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}
function paint(time = 0) {
  ctx.clearRect(0, 0, width, height);
  const t = reduced.matches ? 0 : ((time % 60000) / 60000) * Math.PI * 2;
  for (let i = 0; i < 240; i++) {
    const seed = Math.sin(i * 127.1) * 43758.5453;
    const rand = seed - Math.floor(seed);
    const x = (i / 239) * width;
    const y =
      height * 0.39 +
      Math.sin(i * 0.048 + t) * height * 0.16 +
      Math.cos(i * 0.19 - t) * 50;
    // Fade around the form so animation never competes with text.
    const edge = Math.min(
      1,
      Math.abs(x - width / 2) / (width < 700 ? width * 0.8 : width * 0.37),
    );
    ctx.globalAlpha = (0.08 + rand * 0.22) * edge;
    ctx.fillStyle =
      i % 20 === 0 ? "#e8c547" : i % 20 < 15 ? "#dedee5" : "#676773";
    ctx.fillRect(
      x + Math.sin(t + i) * 12,
      y,
      rand > 0.92 ? 2 : 1,
      rand > 0.92 ? 2 : 1,
    );
  }
}
function tick(time) {
  if (time - last > 32) {
    paint(time);
    last = time;
  }
  frame = requestAnimationFrame(tick);
}
function sync() {
  cancelAnimationFrame(frame);
  resize();
  paint();
  if (!reduced.matches && !document.hidden) frame = requestAnimationFrame(tick);
}
addEventListener("resize", sync);
document.addEventListener("visibilitychange", sync);
reduced.addEventListener("change", sync);
sync();
