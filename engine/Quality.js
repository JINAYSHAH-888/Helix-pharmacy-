import { EventEmitter } from "./EventEmitter.js";

/**
 * Adaptive quality governor. (port of engine/Quality.ts)
 * Tier settings are re-scoped to this scene: no shadows, no textures, no
 * particle budget — the knobs that matter are DPR, the grain/vignette post
 * pass and MSAA on the post target.
 */
const TIERS = {
  low:    { maxDpr: 1,    post: "none",  msaa: 0 },
  medium: { maxDpr: 1.5,  post: "grain", msaa: 4 },
  high:   { maxDpr: 2,    post: "grain", msaa: 4 },
};

export class Quality extends EventEmitter {
  tier = "high";
  get settings() { return TIERS[this.tier]; }

  #ring = [];
  #size = 60;
  #cooldown = 0;
  #locked = false;

  constructor(initial) {
    super();
    this.tier = initial ?? Quality.guess();
  }

  /** cheap startup heuristic — refined immediately by measurement */
  static guess() {
    const mem = navigator.deviceMemory ?? 8;
    const cores = navigator.hardwareConcurrency ?? 8;
    const mobile = matchMedia("(pointer: coarse)").matches;
    const saveData = navigator.connection?.saveData;
    if (saveData || mem <= 2 || cores <= 2) return "low";
    if (mobile || mem <= 4 || cores <= 4) return "medium";
    return "high";
  }

  lock(tier) { this.#locked = true; this.#set(tier); }
  unlock() { this.#locked = false; }

  /** call every RENDERED frame with the frame delta in ms */
  sample(deltaMs) {
    if (this.#locked) return;
    this.#ring.push(deltaMs);
    if (this.#ring.length < this.#size) return;
    if (this.#cooldown > 0) { this.#cooldown--; this.#ring.length = 0; return; }

    const sorted = [...this.#ring].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const avg = this.#ring.reduce((a, b) => a + b, 0) / this.#ring.length;
    this.#ring.length = 0;

    // p95 catches stutter that a good average hides; 20ms p95 == the 50fps floor
    if (avg > 18 || p95 > 22) this.down();
    else if (avg < 11 && p95 < 14) this.up();
  }

  down() { this.#set(this.tier === "high" ? "medium" : "low"); }
  up()   { this.#set(this.tier === "low" ? "medium" : "high"); }

  #set(t) {
    if (t === this.tier) return;
    this.tier = t;
    this.#cooldown = 3;                    // avoid oscillating between tiers
    this.emit("change", t, TIERS[t]);
  }
}
