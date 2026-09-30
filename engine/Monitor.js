/**
 * Frame-time instrumentation. (port of engine/Monitor.ts)
 * `?monitor` in the URL mounts the overlay; stats() is always available and is
 * exposed as window.helixisScene.stats() for the perf audit.
 */
export class Monitor {
  #frames = [];
  #longTasks = [];
  #obs;
  #el;

  constructor(opts = {}) {
    if ("PerformanceObserver" in window) {
      try {
        this.#obs = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            const worst = [...(e.scripts ?? [])].sort((a, b) => b.duration - a.duration)[0];   // e.scripts is frozen: copy before sorting
            this.#longTasks.push({ duration: e.duration, script: worst?.sourceURL });
          }
        });
        this.#obs.observe({ type: "long-animation-frame", buffered: true });
      } catch { /* not supported */ }
    }
    if (opts.overlay) this.#mount();
  }

  tick(delta) {
    this.#frames.push(delta);
    if (this.#frames.length > 240) this.#frames.shift();
    if (this.#el && this.#frames.length % 15 === 0) this.#paint();
  }

  stats() {
    const s = [...this.#frames].sort((a, b) => a - b);
    if (!s.length) return { avg: 0, p95: 0, fps: 0, longTasks: 0 };
    const avg = this.#frames.reduce((a, b) => a + b, 0) / this.#frames.length;
    return {
      avg, p95: s[Math.floor(s.length * 0.95)], fps: 1000 / avg, frames: s.length,
      longTasks: this.#longTasks.length,
      worstScript: [...this.#longTasks].sort((a, b) => b.duration - a.duration)[0]?.script,
    };
  }

  #mount() {
    this.#el = document.createElement("div");
    this.#el.className = "scene-monitor mono";
    document.body.appendChild(this.#el);
  }

  #paint() {
    const s = this.stats();
    this.#el.textContent = `${s.fps.toFixed(0)} fps · avg ${s.avg.toFixed(1)}ms · p95 ${s.p95.toFixed(1)}ms · LoAF ${s.longTasks}`;
  }

  destroy() { this.#obs?.disconnect(); this.#el?.remove(); }
}
