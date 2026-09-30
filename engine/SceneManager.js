/**
 * Resolves which scenes are live and drives the two-input model.
 * (port of engine/SceneManager.ts)
 *
 *   scrub(progress)  <- scroll.  Camera, narrative state, reveals.
 *   update(t, dt)    <- time.    Pulses, messages, clocks, glitch.
 *
 * Adaptation: the original stacks scenes back-to-back in a virtual scroll
 * space (`scrollVh`). This page keeps native document flow, so each scene is
 * anchored to a DOM element and its range comes from that element's live
 * rect: `scene.progress(rect, vh)` → 0..1, or null when far off-screen.
 * update() still runs for every WARM scene so the world off-screen stays alive.
 */
export class SceneManager {
  #slots = [];
  /** how far outside the viewport (px) a scene is kept warm */
  preloadPx = innerHeight;

  add(scene) { this.#slots.push({ scene, state: "cold", rect: null, progress: 0 }); return this; }

  layout() { for (const s of this.#slots) s.scene.layout?.(); }

  update(ctx, elapsed, delta) {
    const vh = innerHeight;
    for (const slot of this.#slots) {
      const rect = slot.scene.el.getBoundingClientRect();
      slot.rect = rect;
      const visible = rect.bottom > 0 && rect.top < vh && rect.width > 0;
      const near = rect.bottom > -this.preloadPx && rect.top < vh + this.preloadPx;

      if (near && slot.state === "cold") { slot.scene.enter?.(ctx); slot.state = "warm"; }
      if (!near && slot.state !== "cold") { slot.scene.leave?.(ctx); slot.state = "cold"; continue; }
      if (!visible && slot.state === "active") { slot.scene.leave?.(ctx); slot.state = "warm"; }
      if (visible && slot.state === "warm") slot.state = "active";
      if (slot.state === "cold") continue;

      if (slot.state === "active") {
        slot.progress = ctx.reducedMotion ? 1 : clamp01(slot.scene.progress(rect, vh));
        slot.scene.scrub?.(ctx, slot.progress);
      }
      slot.scene.update?.(ctx, elapsed, delta);
    }
  }

  /** active slots, for the renderer: [{scene, rect, progress}] */
  active() { return this.#slots.filter((s) => s.state === "active"); }

  destroy(ctx) {
    for (const s of this.#slots) if (s.state !== "cold") s.scene.teardown?.(ctx);
    this.#slots = [];
  }
}

export const clamp01 = (v) => Math.min(1, Math.max(0, v));
