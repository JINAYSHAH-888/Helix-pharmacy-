// GRAIN + VIGNETTE — the cheapest convincing "cinematic" pass.
// Nearly free (no texture taps beyond the input) and it removes the flat,
// digital look faster than bloom or DoF, which cost far more.
//
// Correct order in a post chain: tone mapping -> bloom -> THIS -> output.
precision highp float;
varying vec2 vUv;
#include "../common/uniforms.glsl"
#include "../common/math.glsl"
#include "../noise/noise.glsl"

uniform sampler2D uMap;
uniform float uGrain;        // 0.02 - 0.09. Above 0.12 it reads as a filter.
uniform float uVignette;     // 0.0 - 1.0
uniform float uChroma;       // edge chromatic aberration, 0 - 0.004
uniform float uExposure;

void main(){
  vec2 p = centered(vUv);
  float r2 = dot(p, p);

  vec3 col;
  if (uChroma > 0.0001) {
    // aberration scaled by radius — lenses are sharp in the centre
    vec2 off = p * r2 * uChroma;
    col.r = texture2D(uMap, vUv - off).r;
    col.g = texture2D(uMap, vUv).g;
    col.b = texture2D(uMap, vUv + off).b;
  } else {
    col = texture2D(uMap, vUv).rgb;
  }

  col *= uExposure;

  // vignette in luminance, not a black overlay — keeps hue intact
  float v = 1.0 - saturate(r2 * 0.25) * uVignette;
  col *= v;

  // animated grain. Static grain looks like a texture; animated looks like film.
  float g = hash21(gl_FragCoord.xy + fract(uTime) * 1000.0) - 0.5;
  // more grain in shadows, as real film behaves
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col += g * uGrain * (1.0 - lum * 0.6);

  gl_FragColor = vec4(col, 1.0);
}
