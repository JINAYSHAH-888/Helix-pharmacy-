/** Minimal emitter. Every engine module extends or owns one. (port of engine/EventEmitter.ts) */
export class EventEmitter {
  #map = new Map();
  on(ev, fn) {
    if (!this.#map.has(ev)) this.#map.set(ev, new Set());
    this.#map.get(ev).add(fn);
    return () => this.off(ev, fn);
  }
  off(ev, fn) { this.#map.get(ev)?.delete(fn); }
  emit(ev, ...args) {
    const s = this.#map.get(ev);
    if (!s) return;
    for (const fn of s) fn(...args);
  }
  destroy() { this.#map.clear(); }
}
