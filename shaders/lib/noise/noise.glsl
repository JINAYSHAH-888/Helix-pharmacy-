// Value + simplex noise and fbm. The workhorse of every generative background.

float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
vec2  hash22(vec2 p){
  vec3 a = fract(p.xyx * vec3(123.34, 234.34, 345.65));
  a += dot(a, a + 34.45);
  return fract(vec2(a.x*a.y, a.y*a.z));
}

float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0 - 2.0*f);                      // smoothstep interpolation
  return mix(mix(hash21(i),             hash21(i+vec2(1,0)), f.x),
             mix(hash21(i+vec2(0,1)),   hash21(i+vec2(1,1)), f.x), f.y);
}

// simplex — smoother gradients, no grid artifacts, ~2x the cost of value noise
vec3 permute(vec3 x){ return mod(((x*34.0)+1.0)*x, 289.0); }
float snoise(vec2 v){
  const vec4 C = vec4(0.211324865, 0.366025403, -0.577350269, 0.024390243);
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v -   i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0,0.0) : vec2(0.0,1.0);
  vec4 x12 = x0.xyxy + C.xxzz; x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
  m = m*m; m = m*m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5, ox = floor(x + 0.5), a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
  vec3 g; g.x = a0.x*x0.x + h.x*x0.y; g.yz = a0.yz*x12.xz + h.yz*x12.yw;
  return 130.0 * dot(m, g);
}

/** fractal brownian motion — layered noise. 4-5 octaves is the sweet spot. */
float fbm(vec2 p, int octaves){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 8; i++){
    if (i >= octaves) break;
    v += a * snoise(p);
    p *= 2.02;                                 // non-integer: avoids axis alignment
    a *= 0.5;
  }
  return v;
}
float fbm(vec2 p){ return fbm(p, 5); }

/** domain-warped fbm — the difference between "noise" and "looks designed" */
float warpedFbm(vec2 p, float strength){
  vec2 q = vec2(fbm(p), fbm(p + vec2(5.2, 1.3)));
  vec2 r = vec2(fbm(p + strength*q + vec2(1.7, 9.2)),
                fbm(p + strength*q + vec2(8.3, 2.8)));
  return fbm(p + strength*r);
}

/** curl of a noise field — divergence-free, so particles swirl and never clump */
vec2 curl(vec2 p){
  const float e = 0.01;
  float n1 = snoise(p + vec2(0.0, e)), n2 = snoise(p - vec2(0.0, e));
  float n3 = snoise(p + vec2(e, 0.0)), n4 = snoise(p - vec2(e, 0.0));
  return normalize(vec2(n1 - n2, -(n3 - n4)) / (2.0 * e));
}
