import { EventEmitter } from "./EventEmitter.js";

/**
 * The single RAF loop for the entire application. (port of engine/Time.ts)
 * Nothing else may call requestAnimationFrame.
 *
 * Adaptation: when a GSAP ticker is supplied, Time rides it instead of owning
 * its own RAF. ScrollSmoother updates on that same ticker, so the smoothed
 * scroll, the DOM transform and the WebGL frame all share one tick — no
 * one-frame offset between DOM windows and the scissored views.
 */
export class Time extends EventEmitter {
  elapsed = 0;
  delta = 16.666;
  #last = performance.now();
  #raf = 0;
  #running = false;
  #demand = false;
  #dirty = true;
  #ticker = null;

  constructor(opts = {}) {
    super();
    this.#demand = opts.demand ?? false;
    this.#ticker = opts.ticker ?? null;
    document.addEventListener("visibilitychange", this.#onVisibility);
  }

  get demand() { return this.#demand; }
  set demand(v) { this.#demand = v; this.invalidate(); }

  start() {
    if (this.#running) return;
    this.#running = true;
    this.#last = performance.now();
    if (this.#ticker) this.#ticker.add(this.#step);
    else this.#loop();
  }

  stop() {
    this.#running = false;
    if (this.#ticker) this.#ticker.remove(this.#step);
    cancelAnimationFrame(this.#raf);
    this.#raf = 0;
  }

  /** Wake a demand-mode loop for at least one frame. */
  invalidate() {
    this.#dirty = true;
    if (this.#running && !this.#ticker && !this.#raf) this.#loop();
  }

  #onVisibility = () => {
    if (document.hidden) this.stop();
    else { this.#last = performance.now(); this.start(); }
  };

  #loop = () => {
    if (!this.#running) return;
    this.#raf = requestAnimationFrame(this.#loop);
    this.#step();
  };

  #step = () => {
    const now = performance.now();
    // clamp: a backgrounded tab returning would otherwise explode simulations
    this.delta = Math.min(now - this.#last, 64);
    this.#last = now;
    this.elapsed += this.delta;
    if (this.#demand && !this.#dirty) return;
    this.#dirty = false;
    this.emit("tick", this.elapsed, this.delta);
  };

  destroy() {
    this.stop();
    document.removeEventListener("visibilitychange", this.#onVisibility);
    super.destroy();
  }
}
