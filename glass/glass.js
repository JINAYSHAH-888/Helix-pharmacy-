/**
 * Glass galaxy buttons — behaviour (see DESIGN.md → Amendment, adapted from ThreeUI
 * GlassAiButton). One shared 2D canvas plays every particle burst, so any number of
 * buttons costs no WebGL contexts. Links stay real links: the burst plays, then the
 * navigation continues ~280 ms later (immediately with modifier keys / reduced motion).
 */
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
let canvas, ctx, particles = [], rings = [], raf = 0, colors;

/** Draw one two-arm spiral galaxy (log-spiral star field) and share it with every orb. */
function paintGalaxy() {
  if (document.documentElement.style.getPropertyValue('--gb-galaxy')) return;
  const n = 160, c = document.createElement('canvas'); c.width = c.height = n;
  const g = c.getContext('2d'), cx = n / 2, arm = css('--orb-arm') || 'white', spec = css('--orb-spec') || 'white';
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 1400; i++) {
    const a = i % 2, t = Math.pow(rnd(), 0.75) * 3.4;              // position along the arm
    const r = 4 + t * 20 + (rnd() - 0.5) * (3 + t * 3);             // arms widen outward
    const ang = a * Math.PI + t * 1.45 + (rnd() - 0.5) * 0.35;
    g.globalAlpha = Math.max(0.15, 1 - t / 3.6) * (0.5 + rnd() * 0.5);
    g.fillStyle = rnd() < 0.12 ? spec : arm;
    g.beginPath(); g.arc(cx + Math.cos(ang) * r, cx + Math.sin(ang) * r, 0.35 + rnd() * 0.9, 0, Math.PI * 2); g.fill();
  }
  const core = g.createRadialGradient(cx, cx, 0, cx, cx, 16);
  core.addColorStop(0, spec); core.addColorStop(1, 'transparent');
  g.globalAlpha = 0.9; g.fillStyle = core; g.fillRect(0, 0, n, n);
  document.documentElement.style.setProperty('--gb-galaxy', `url(${c.toDataURL()})`);
}

function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

function ensureCanvas() {
  if (canvas) return;
  canvas = document.createElement('canvas');
  canvas.className = 'glass-burst-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);
  ctx = canvas.getContext('2d');
  const size = () => { const d = Math.min(devicePixelRatio || 1, 2); canvas.width = innerWidth * d; canvas.height = innerHeight * d; ctx.setTransform(d, 0, 0, d, 0, 0); };
  size();
  addEventListener('resize', size, { passive: true });
  colors = { spark: css('--spark'), ring: css('--spark-ring'), glow: css('--glass-glow'), deep: css('--orb-mid'), core: css('--orb-core') };
}

function frame() {
  raf = 0;
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  const now = performance.now();
  rings = rings.filter((r) => now - r.t0 < r.life);
  for (const r of rings) {
    const k = (now - r.t0) / r.life, e = 1 - Math.pow(1 - k, 3);
    ctx.strokeStyle = colors.core; ctx.globalAlpha = (1 - k) * 0.9; ctx.lineWidth = 1.5 * (1 - k) + 0.5;
    ctx.beginPath(); ctx.arc(r.x, r.y, r.r0 + e * r.grow, 0, Math.PI * 2); ctx.stroke();
  }
  particles = particles.filter((p) => now - p.t0 < p.life);
  for (const p of particles) {
    const k = (now - p.t0) / p.life, e = 1 - Math.pow(1 - k, 2.6);
    const x = p.x + Math.cos(p.a) * p.d * e, y = p.y + Math.sin(p.a) * p.d * e;
    ctx.globalAlpha = (1 - k) * p.o;
    if (p.streak) {
      ctx.strokeStyle = colors.core; ctx.lineWidth = 1.1;
      ctx.beginPath(); ctx.moveTo(x - Math.cos(p.a) * 9 * (1 - k), y - Math.sin(p.a) * 9 * (1 - k)); ctx.lineTo(x, y); ctx.stroke();
    } else {
      const rad = p.s * (1 - k * 0.6);
      ctx.fillStyle = colors.deep; ctx.beginPath(); ctx.arc(x, y, rad * 1.6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = colors.spark; ctx.beginPath(); ctx.arc(x, y, rad * 0.7, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  if (particles.length || rings.length) raf = requestAnimationFrame(frame);
}

/** Particle burst + light ring from a point (the orb of the pressed button). */
export function burst(x, y, scale = 1) {
  if (reduced()) return;
  ensureCanvas();
  const t0 = performance.now();
  for (let i = 0; i < 90; i++) {
    const a = Math.random() * Math.PI * 2;
    particles.push({ x, y, a, t0, d: (18 + Math.random() * 70) * scale, life: 520 + Math.random() * 480,
      s: 0.6 + Math.random() * 1.6, o: 0.5 + Math.random() * 0.5, streak: Math.random() < 0.18 });
  }
  rings.push({ x, y, t0, life: 700, r0: 10 * scale, grow: 60 * scale });
  rings.push({ x, y, t0: t0 + 90, life: 620, r0: 6 * scale, grow: 34 * scale });
  if (!raf) raf = requestAnimationFrame(frame);
}

function onPress(e) {
  const btn = e.currentTarget;
  if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') return;
  const orb = btn.querySelector('.gb-orb') || btn;
  const r = orb.getBoundingClientRect();
  burst(r.left + r.width / 2, r.top + r.height / 2, Math.max(0.6, r.height / 34));
  // links: let the burst read, then follow the link (skip the delay for new-tab clicks)
  const href = btn.tagName === 'A' ? btn.getAttribute('href') : null;
  if (href && !href.startsWith('#') && !reduced() && !e.defaultPrevented && e.button === 0
      && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && btn.target !== '_blank') {
    e.preventDefault();
    setTimeout(() => { window.location.href = btn.href; }, 280);
  }
}

/** Turn existing buttons/links into glass buttons (adds the orb + burst). Idempotent. */
export function enhance(el, { orb = true, size } = {}) {
  if (!el || el.dataset.glass === 'on') return el;
  el.dataset.glass = 'on';
  paintGalaxy();
  el.classList.add('glass-btn');
  if (size) el.classList.add(`glass-btn--${size}`);
  if (orb) {
    const o = document.createElement('span');
    o.className = 'gb-orb';
    o.setAttribute('aria-hidden', 'true');
    el.prepend(o);
  } else {
    el.classList.add('glass-btn--icon');
  }
  el.addEventListener('click', onPress);
  return el;
}

/** Enhance everything matching a selector now and whenever it is added later. */
export function enhanceAll(selector, opts = {}, root = document) {
  const run = () => root.querySelectorAll(selector).forEach((el) => enhance(el, typeof opts === 'function' ? opts(el) : opts));
  run();
  new MutationObserver(run).observe(root.body || root, { childList: true, subtree: true });
}
