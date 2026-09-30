import * as THREE from "three";
import { Experience } from "../engine/index.js";
import { World } from "./world.js";
import { Views } from "./views.js";
import { HeroSim, ElectionSim, FaultSim, ClockSim, ChainSim } from "./sims.js";
import { live, ingestNetwork, ingestData, chain, sealChain, verifyChain, setTamper, TAMPER, NODES } from "./model.js";

/**
 * Bootstrap. One Experience (one tick), one World, one canvas, five windows.
 * Colours come from the CSS tokens at runtime — no colour literal lives in JS.
 */
THREE.ColorManagement.enabled = false;
const root = document.documentElement;
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2"));
  } catch { return false; }
}

/* read a token through a 1px 2D canvas so oklch() resolves to sRGB bytes */
const probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
function token(name) {
  const value = getComputedStyle(root).getPropertyValue(name).trim();
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = value;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
  return new THREE.Color(r / 255, g / 255, b / 255);
}
function palette() {
  const paper = token("--paper"), ink = token("--ink");
  return {
    paper: { bg: paper, fg: ink, mid: paper.clone().lerp(ink, 0.42), dead: ink, good: token("--good"), warn: token("--warn"), danger: token("--danger") },
    ink: { bg: ink, fg: paper, mid: ink.clone().lerp(paper, 0.38), dead: token("--dark-line"), good: token("--good-on-dark"), warn: token("--warn-on-dark"), danger: token("--danger-on-dark") },
  };
}

function boot() {
  const canvas = document.getElementById("scene-canvas");
  if (!canvas || !webglAvailable()) { root.classList.add("no-webgl"); return; }

  const pal = palette();
  const world = new World(pal);
  let views;
  const exp = new Experience({
    ticker: window.gsap?.ticker,
    readScroll: () => window.helixisScroll?.smoother?.scrollTop() ?? scrollY,
    debug: new URLSearchParams(location.search).has("monitor"),
  });
  try {
    views = new Views({ canvas, world, palette: pal, quality: exp.quality, header: document.getElementById("site-header") });
  } catch (error) {
    console.warn("WebGL renderer unavailable; keeping the static posters.", error);
    root.classList.add("no-webgl");
    return;
  }
  views.resize(exp.sizes.dpr);
  exp.sizes.on("resize", (s) => views.resize(s.dpr));

  /* ── DOM hooks beside each window ───────────────────────────────────── */
  const logList = document.querySelector("[data-scene-log]");
  const pushLog = (line) => {
    if (!logList) return;
    const li = document.createElement("li");
    li.textContent = line;
    logList.prepend(li);
    while (logList.children.length > 5) logList.lastElementChild.remove();
  };
  const vcOut = document.querySelector("[data-vc-readout]");
  const showVc = (r) => {
    if (!vcOut) return;
    vcOut.dataset.phase = r.phase;
    vcOut.querySelector("[data-vc-del]").textContent = r.text?.del ?? "—";
    vcOut.querySelector("[data-vc-blr]").textContent = r.text?.blr ?? "—";
    vcOut.querySelector("[data-vc-rel]").textContent = r.relation ? (r.relation === "CONCURRENT" ? "∥ CONCURRENT — neither happened-before the other" : r.relation) : "waiting for the concurrent write";
    vcOut.querySelector("[data-vc-ver]").textContent = r.phase === 3 ? "v7 → v8 committed · stale write (expected v7, found v8) rejected, re-read, merged" : r.phase >= 1 ? "both writers read row v7" : "row v7";
  };

  const sims = {
    hero: new HeroSim(),
    election: new ElectionSim(pushLog),
    fault: new FaultSim(),
    consistency: new ClockSim(showVc),
    integrity: new ChainSim(),
  };

  /* reduced motion: run each chapter to its final state, a few seconds of traffic
     in flight, then freeze — the windows are never empty */
  if (reduced) {
    for (const sim of Object.values(sims)) {
      sim.scrub(1);
      for (let k = 0; k < 70; k++) sim.update(k * 0.05, 0.05);
      sim.reduced = true;
    }
  }

  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  if (!reduced) addEventListener("pointermove", (ev) => { pointer.tx = (ev.clientX / innerWidth) * 2 - 1; pointer.ty = -((ev.clientY / innerHeight) * 2 - 1); }, { passive: true });

  const rails = new Map();
  for (const el of document.querySelectorAll("[data-scene]")) {
    const chapter = el.dataset.scene;
    const sim = sims[chapter];
    if (!sim) continue;
    const rail = document.querySelector(`[data-scene-rail="${chapter}"]`);
    const status = document.querySelector(`[data-scene-status="${chapter}"]`);
    rails.set(chapter, { rail, status, key: "" });
    exp.addScene({
      el, chapter, sim,
      progress(rect, vh) {
        if (chapter === "hero") return window.helixisScroll?.heroTrigger?.progress ?? 0;
        return (vh * 0.8 - rect.top) / (rect.height + vh * 0.12);
      },
      scrub(ctx, p) { this.p = p; sim.scrub(p); },
      update(ctx, t, dt) { sim.update(t / 1000, dt / 1000); },
    });
  }

  function paintRail(chapter, sim) {
    const r = rails.get(chapter);
    if (!r?.rail || !sim.rail) return;
    const { steps, active, source, note } = sim.rail();
    const key = `${steps.join("|")}#${active}#${source}#${note}`;
    if (key === r.key) return;
    r.key = key;
    r.rail.innerHTML = steps.map((s, i) => `<li${i === active ? ' aria-current="step"' : ""}${i < active ? ' class="is-done"' : ""}><span>${String(i + 1).padStart(2, "0")}</span>${s}</li>`).join("");
    if (r.status) r.status.textContent = [source, note].filter(Boolean).join(" · ") || (live.mode === "rmi-live" ? "LIVE" : "MODEL");
  }

  exp.addRenderer((ctx, elapsed) => {
    const t = elapsed / 1000;
    pointer.x += (pointer.tx - pointer.x) * 0.05;
    pointer.y += (pointer.ty - pointer.y) * 0.05;
    views.begin();
    let drew = false;
    const narrow = innerWidth < 700;
    for (const slot of exp.scenes.active()) {
      const s = slot.scene;
      const ok = views.draw({ id: s.chapter, rect: slot.rect, chapter: s.chapter, progress: slot.progress, sim: s.sim, t, rm: reduced, pointer, narrow });
      if (ok) paintRail(s.chapter, s.sim);
      drew = ok || drew;
    }
    views.end();
    return drew;
  });

  /* ── live data from script.js ───────────────────────────────────────── */
  const heroReadout = document.querySelector("[data-hero-readout]");
  const paintHero = () => {
    if (!heroReadout) return;
    const alive = live.nodes.filter((n) => n.alive).length;
    const mode = { "rmi-live": "LIVE · RMI REGISTRIES PROBED", "catalog-only": "CATALOG · REGISTRIES NOT RUNNING, DECLARED STATUS", none: "MODEL · GATEWAY UNREACHABLE" }[live.mode] ?? live.mode;
    heroReadout.querySelector("[data-hr-mode]").textContent = mode;
    heroReadout.querySelector("[data-hr-alive]").textContent = `${alive} / ${NODES.length}`;
    heroReadout.querySelector("[data-hr-rtt]").textContent = live.rtt == null ? "—" : `${live.rtt.toFixed(1)} ms`;
    heroReadout.querySelector("[data-hr-coord]").textContent = live.coordinator ?? (live.mode === "rmi-live" ? "none" : "not probed");
  };
  document.addEventListener("helixis:network", (ev) => { ingestNetwork(ev.detail.network, ev.detail.rtt); paintHero(); exp.invalidate(); });
  document.addEventListener("helixis:data", async (ev) => {
    ingestData(ev.detail);
    ingestNetwork(ev.detail.network, ev.detail.rtt);
    paintHero();
    if (!chain.ready && live.prescriptions.length) await sealChain(live.prescriptions);
    exp.invalidate();
  });
  document.addEventListener("helixis:fault", (ev) => { live.fault = ev.detail; live.faultFollow = true; exp.invalidate(); });
  if (window.helixisData) document.dispatchEvent(new CustomEvent("helixis:data", { detail: window.helixisData }));
  paintHero();

  /* ── integrity controls (real SHA-256 in the browser) ──────────────── */
  const integrity = document.querySelector("[data-integrity]");
  const paintIntegrity = () => {
    if (!integrity) return;
    const blocks = chain.blocks;
    const q = (s) => integrity.querySelector(s);
    if (!chain.supported) { q("[data-int-summary]").textContent = "SubtleCrypto unavailable in this context (needs https or localhost)."; return; }
    if (!blocks.length) return;
    const bad = blocks.filter((b) => !b.valid).length;
    const unproven = blocks.filter((b) => b.valid && !b.linkValid).length;
    q("[data-int-verified]").textContent = `${blocks.length - bad - unproven} / ${blocks.length}`;
    q("[data-int-tampered]").textContent = bad ? blocks.map((b, i) => (!b.valid ? String(i + 1).padStart(3, "0") : null)).filter(Boolean).join(", ") : "none";
    q("[data-int-unproven]").textContent = String(unproven);
    q("[data-int-ms]").textContent = `${chain.verifyMs.toFixed(1)} ms`;
    const b = blocks[TAMPER.index];
    q("[data-int-seal]").textContent = b.sealed;
    q("[data-int-now]").textContent = b.now;
    q("[data-int-field]").textContent = chain.tampered ? `quantity ${b.rx.quantity} → ${TAMPER.to} (edited after sealing)` : `quantity ${b.rx.quantity} (original)`;
    integrity.dataset.state = bad ? "tampered" : "clean";
    const toggle = q("[data-int-toggle]");
    toggle.textContent = chain.tampered ? "Restore 017's original record" : "Re-apply the 017 edit";
    toggle.setAttribute("aria-pressed", String(!chain.tampered));
    document.dispatchEvent(new CustomEvent("helixis:chain", { detail: { tampered: blocks.filter((x) => !x.valid).map((x) => x.rx.id) } }));
    world.paintGlitch([`RX 017 · TAMPERED`, `seal ${b.sealed.slice(0, 16)}…`, `now  ${b.now.slice(0, 16)}…`], pal.ink.danger);
  };
  chain.listeners.add(paintIntegrity);
  integrity?.querySelector("[data-int-verify]")?.addEventListener("click", async (ev) => {
    const btn = ev.currentTarget;
    btn.setAttribute("aria-busy", "true"); btn.disabled = true;
    await verifyChain();
    btn.removeAttribute("aria-busy"); btn.disabled = false;
  });
  integrity?.querySelector("[data-int-toggle]")?.addEventListener("click", () => setTamper(!chain.tampered));

  /* ── go ─────────────────────────────────────────────────────────────── */
  document.fonts?.ready.then(() => chain.ready && paintIntegrity());
  views.compile();
  root.classList.add("has-webgl");
  exp.start();
  window.helixisScene = { stats: () => exp.monitor.stats(), quality: () => exp.quality.tier, live, chain };
}

boot();
