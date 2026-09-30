#define PI  3.141592653589793
#define TAU 6.283185307179586

float saturate(float x){ return clamp(x, 0.0, 1.0); }
vec2  saturate(vec2 x){ return clamp(x, 0.0, 1.0); }

// remap a..b -> 0..1
float range(float v, float a, float b){ return saturate((v - a) / (b - a)); }

// easings — match the CSS tokens so DOM and GPU motion agree
float easeOutExpo(float t){ return t >= 1.0 ? 1.0 : 1.0 - pow(2.0, -10.0 * t); }
float easeInOutCubic(float t){
  return t < 0.5 ? 4.0*t*t*t : 1.0 - pow(-2.0*t + 2.0, 3.0) / 2.0;
}
float easeOutBack(float t){
  float c1 = 1.70158, c3 = c1 + 1.0;
  return 1.0 + c3 * pow(t - 1.0, 3.0) + c1 * pow(t - 1.0, 2.0);
}

// 2D rotation
mat2 rot(float a){ float s = sin(a), c = cos(a); return mat2(c, -s, s, c); }

// stagger: returns local 0..1 progress for item i of n given global p
float stagger(float p, float i, float n, float overlap){
  float span = 1.0 / (n - (n - 1.0) * overlap);
  float start = i * span * (1.0 - overlap);
  return saturate((p - start) / span);
}
