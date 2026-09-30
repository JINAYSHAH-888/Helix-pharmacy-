/** Scroll-tweened state for the capsule stage. Lives outside Stage.js so the timeline
 *  can be built before three.js (a separate, lazily-loaded chunk) has arrived. */
export function createState() {
  return {
    intro: 0,        // 0..1 load-in scale
    capX: 0.34,      // capsule centre, fraction of half-viewport width (+ right)
    capY: 0,         // fraction of half-viewport height (+ up)
    capScale: 1,
    turn: 0,         // extra scroll-driven rotation (radians) on top of idle spin
    tilt: 0.55,      // lean of the long axis
    orbit: 0,        // 0..1 six node-capsules visible + radius
    split: 0,        // 0..1 halves separated along the shared axis
    burst: 0,        // 0..1 granules released
    ring: 0,         // 0..1 granules re-formed into six node clusters
    labels: 0,       // 0..1 node label opacity
  };
}
