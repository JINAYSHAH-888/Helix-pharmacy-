import { EventEmitter } from "./EventEmitter.js";

/** Viewport + DPR, debounced. (port of engine/Sizes.ts) */
export class Sizes extends EventEmitter {
  width = 0; height = 0; dpr = 1; maxDpr = 2;
  #t = 0;

  constructor() {
    super();
    this.#measure();
    addEventListener("resize", this.#onResize, { passive: true });
  }

  setMaxDpr(v) { this.maxDpr = v; this.#measure(); this.emit("resize", this); }

  #measure() {
    this.width = innerWidth;
    this.height = innerHeight;
    this.dpr = Math.min(devicePixelRatio || 1, this.maxDpr);
  }

  /** debounced — resize fires continuously on mobile URL-bar collapse */
  #onResize = () => {
    clearTimeout(this.#t);
    this.#t = window.setTimeout(() => { this.#measure(); this.emit("resize", this); }, 120);
  };

  destroy() { removeEventListener("resize", this.#onResize); clearTimeout(this.#t); super.destroy(); }
}
