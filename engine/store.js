/**
 * The state bus. (port of engine/store.ts without zustand — this page has no
 * React.) Per-frame values are written ONCE at the top of the frame and read
 * imperatively by everyone after. DOM subscribers use subscribe(); render loops
 * read experience() directly.
 */
const state = {
  scroll: 0, scrollVelocity: 0, scrollProgress: 0, isScrolling: false,
  section: "", sectionProgress: 0,
  quality: "high",
  reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
  ready: false,
};
const subs = new Set();

export const experience = () => state;
export function setState(patch) {
  Object.assign(state, patch);
  for (const fn of subs) fn(state);
}
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
