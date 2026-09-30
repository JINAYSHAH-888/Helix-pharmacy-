// NODE FIELD — the surface of one RMI registry.
// Legibility contract: thin scan bands climb the side faces while the node is
// ALIVE (its activity); simplex noise modulates their strength per facet so the
// six nodes never pulse in lockstep; a received message (uPulse) floods the body;
// a crashed node is a solid ink prism with no bands at all.
precision highp float;
#include "../lib/common/uniforms.glsl"
#include "../lib/common/math.glsl"
#include "../lib/noise/noise.glsl"

varying vec3 vLocal;
varying vec3 vNormalO;
varying vec2 vUv;

uniform vec3  uBg;        // window background (paper or ink)
uniform vec3  uFg;        // window foreground (ink or paper)
uniform vec3  uDead;      // crashed body
uniform float uAlive;     // 0 crashed .. 1 alive (animated on transition)
uniform float uPulse;     // 0..1, decays after a message is received
uniform float uLeader;    // 0..1 coordinator / primary emphasis
uniform float uSeed;
uniform float uWarn;      // 0..1 conflict / catch-up tint
uniform vec3  uWarnCol;

void main(){
  float side = 1.0 - step(0.9, abs(vNormalO.y));
  float angle = atan(vLocal.z, vLocal.x);

  float scan = fract(vLocal.y * 4.0 - uTime * 0.55 + uSeed);
  float band = smoothstep(0.0, 0.04, scan) * (1.0 - smoothstep(0.08, 0.14, scan));
  float n = snoise(vec2(floor(angle * 0.955) * 3.1 + uSeed, uTime * 0.35)) * 0.5 + 0.5;
  float field = band * (0.25 + 0.75 * n) * 0.34 * uAlive * side;

  // flat facet shading: top face lighter, sides stepped by facet — reads as a solid prism
  float facet = mix(0.965 + 0.035 * sin(floor(angle * 0.955) * 2.0), 1.0, 1.0 - side);

  vec3 body = mix(uBg, uFg, 0.05 + field + uPulse * 0.22 + uLeader * 0.1);
  body = mix(body, uWarnCol, uWarn * 0.5);
  body *= facet;
  vec3 col = mix(uDead, body, uAlive);

  col += (hash21(gl_FragCoord.xy) - 0.5) / 255.0;   // dither the low-chroma body
  gl_FragColor = vec4(col, 1.0);
}
