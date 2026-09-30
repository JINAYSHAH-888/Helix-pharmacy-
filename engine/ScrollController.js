import { EventEmitter } from "./EventEmitter.js";

/**
 * Scroll snapshot owner. (port of engine/ScrollController.ts, native mode only)
 *
 * Adaptation: the page already runs GSAP ScrollSmoother, which does the easing.
 * So `read` returns the SMOOTHED position (smoother.scrollTop()) and the lerp
 * here defaults to 1 — easing twice would desync the DOM from the GPU.
 * Virtual (wheel-stealing) mode is deliberately not ported: this is a content
 * page and keyboard / Find-in-page must keep working.
 */
export class ScrollController extends EventEmitter {
  target = 0; current = 0; velocity = 0; limit = 0;
  direction = 0;
  isScrolling = false;
  #idleT = 0;
  #lerp;
  #read;

  constructor(opts = {}) {
    super();
    this.#lerp = opts.lerp ?? 1;
    this.#read = opts.read ?? (() => scrollY);
    this.target = this.current = this.#read();
    this.#measure();
    addEventListener("resize", this.#measure, { passive: true });
  }

  setReader(fn) { this.#read = fn; }

  #measure = () => {
    this.limit = Math.max(0, document.documentElement.scrollHeight - innerHeight);
  };

  /** call once per frame from Time, before any scene update */
  update() {
    this.target = this.#read();
    const prev = this.current;
    this.current += (this.target - this.current) * this.#lerp;
    if (Math.abs(this.target - this.current) < 0.05) this.current = this.target;

    this.velocity = (this.current - prev) * 0.9;           // decay so motion settles
    this.direction = this.velocity > 0.1 ? 1 : this.velocity < -0.1 ? -1 : 0;

    const moving = Math.abs(this.velocity) > 0.1;
    if (moving) { this.isScrolling = true; this.#idleT = 0; }
    else if (this.isScrolling && ++this.#idleT > 10) this.isScrolling = false;

    const snap = this.snapshot();
    this.emit("scroll", snap);
    return snap;
  }

  snapshot() {
    return {
      current: this.current, target: this.target, velocity: this.velocity,
      progress: this.limit ? this.current / this.limit : 0,
      limit: this.limit, direction: this.direction, isScrolling: this.isScrolling,
    };
  }

  destroy() { removeEventListener("resize", this.#measure); super.destroy(); }
}
