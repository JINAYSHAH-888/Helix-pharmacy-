// VELOCITY IMAGE DISTORTION — the signature "expensive site" effect.
// Scroll velocity bends UVs and splits RGB. Pointer adds a local lens.
// Budget: 3 texture lookups. Drop to 1 on the low quality tier.
precision highp float;
varying vec2 vUv;
#include "../common/uniforms.glsl"
#include "../common/math.glsl"

uniform sampler2D uMap;
uniform vec2  uPlaneSize;
uniform vec2  uImageSize;
uniform float uHover;
uniform float uReveal;      // 0..1 entrance
uniform int   uQuality;     // 0 low, 1 medium, 2 high

/** object-fit: cover, computed in the shader so the mesh can be any aspect */
vec2 cover(vec2 uv, vec2 plane, vec2 img){
  vec2 r = vec2(plane.x/plane.y, img.x/img.y);
  vec2 s = r.x < r.y ? vec2(r.x/r.y, 1.0) : vec2(1.0, r.y/r.x);
  return (uv - 0.5) * s + 0.5;
}

void main(){
  vec2 uv = cover(vUv, uPlaneSize, uImageSize);

  // bend more in the middle than at the edges — a flat offset looks like a bug
  float bend = sin(vUv.x * PI);
  uv.y += uVelocity * 0.05 * bend;
  uv.x += uVelocity * 0.012 * sin(vUv.y * PI * 2.0);

  // pointer lens, falling off with distance
  vec2 toMouse = vUv - (uMouse * 0.5 + 0.5);
  float lens = exp(-dot(toMouse, toMouse) * 12.0) * uHover;
  uv -= toMouse * lens * 0.06;

  // entrance: scale-in from a slightly zoomed crop
  uv = (uv - 0.5) * mix(1.12, 1.0, easeOutExpo(uReveal)) + 0.5;

  vec4 c;
  if (uQuality == 0) {
    c = texture2D(uMap, uv);
  } else {
    float ab = abs(uVelocity) * 0.010 + lens * 0.006;
    c.r = texture2D(uMap, uv + vec2(ab, 0.0)).r;
    c.g = texture2D(uMap, uv).g;
    c.b = texture2D(uMap, uv - vec2(ab, 0.0)).b;
    c.a = 1.0;
  }

  // clip-path style reveal from the bottom
  float mask = step(1.0 - uReveal, vUv.y + 0.001);
  gl_FragColor = vec4(c.rgb, c.a * mask);
}
