import { Time } from "./Time.js";
import { Sizes } from "./Sizes.js";
import { ScrollController } from "./ScrollController.js";
import { SceneManager } from "./SceneManager.js";
import { Quality } from "./Quality.js";
import { Monitor } from "./Monitor.js";
import { setState } from "./store.js";

/**
 * The single owner. One instance per page. (port of engine/Experience.ts)
 *
 * Fixed frame order — do not reorder:
 *   time -> scroll -> world update -> scenes (scrub/update) -> render -> monitor -> quality
 */
export class Experience {
  constructor(opts = {}) {
    this.quality = new Quality(opts.tier);
    this.sizes = new Sizes();
    this.sizes.setMaxDpr(this.quality.settings.maxDpr);
    this.reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    // reduced motion: render only when something changes (scroll, resize, data)
    this.time = new Time({ ticker: opts.ticker, demand: this.reducedMotion });
    this.scroll = new ScrollController({ read: opts.readScroll });
    this.monitor = new Monitor({ overlay: opts.debug });
    this.scenes = new SceneManager();
    this.systems = [];      // time-driven world systems, run before scenes
    this.renderers = [];

    this.ctx = {
      scroll: this.scroll.snapshot(),
      quality: this.quality.tier,
      reducedMotion: this.reducedMotion,
    };

    this.quality.on("change", (tier, s) => {
      this.ctx.quality = tier;
      this.sizes.setMaxDpr(s.maxDpr);
      setState({ quality: tier });
    });
    this.sizes.on("resize", () => { this.scenes.layout(); this.time.invalidate(); });
    if (this.reducedMotion) addEventListener("scroll", () => this.time.invalidate(), { passive: true });
    this.time.on("tick", this.#frame);
  }

  addScene(s) { this.scenes.add(s); return this; }
  addSystem(fn) { this.systems.push(fn); return this; }
  addRenderer(fn) { this.renderers.push(fn); return this; }
  start() { this.scenes.layout(); this.time.start(); setState({ ready: true }); }
  invalidate() { this.time.invalidate(); }

  #frame = (elapsed, delta) => {
    // reduced motion freezes simulation time; scenes still render their final state
    const dt = this.reducedMotion ? 0 : delta;
    const snap = this.scroll.update();
    this.ctx.scroll = snap;
    setState({ scroll: snap.current, scrollVelocity: snap.velocity, scrollProgress: snap.progress, isScrolling: snap.isScrolling });

    for (const sys of this.systems) sys(this.ctx, elapsed, dt);
    this.scenes.update(this.ctx, elapsed, dt);
    let rendered = false;
    for (const r of this.renderers) rendered = r(this.ctx, elapsed, dt) || rendered;

    if (rendered) {
      this.monitor.tick(delta);
      if (!this.reducedMotion) this.quality.sample(delta);
    }
  };

  destroy() {
    this.scenes.destroy(this.ctx);
    this.time.destroy(); this.sizes.destroy();
    this.scroll.destroy(); this.monitor.destroy();
  }
}
