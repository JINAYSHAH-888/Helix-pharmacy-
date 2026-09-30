// ---------------------------------------------------------------------------
// SHARED UNIFORM CONTRACT
// Every shader in this library expects these names. Feed them from the same
// state bus the DOM reads, once per frame, so nothing can disagree about time.
// ---------------------------------------------------------------------------
uniform float uTime;        // seconds since start
uniform float uDelta;       // seconds since last frame, CLAMPED (see Time.ts)
uniform vec2  uResolution;  // css px * dpr
uniform float uDpr;

uniform float uScroll;          // 0..1 document progress
uniform float uVelocity;        // px/frame, smoothed and decayed
uniform float uSectionProgress; // 0..1 within the active scene

uniform vec2  uMouse;           // -1..1, y up
uniform vec2  uMouseVelocity;

uniform vec3  uColorA;
uniform vec3  uColorB;
uniform float uIntensity;

// aspect-corrected, centred coordinates: (0,0) at centre, 1 unit = half-height
vec2 centered(vec2 uv) {
  vec2 p = uv - 0.5;
  p.x *= uResolution.x / uResolution.y;
  return p * 2.0;
}
