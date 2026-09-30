// OKLab conversions — mix colors HERE, never in sRGB. sRGB interpolation
// greys out the midpoint of a two-hue gradient; OKLab does not.

vec3 linearToOklab(vec3 c){
  float l = 0.4122214708*c.r + 0.5363325363*c.g + 0.0514459929*c.b;
  float m = 0.2119034982*c.r + 0.6806995451*c.g + 0.1073969566*c.b;
  float s = 0.0883024619*c.r + 0.2817188376*c.g + 0.6299787005*c.b;
  vec3 lms = pow(vec3(l,m,s), vec3(1.0/3.0));
  return vec3(
    0.2104542553*lms.x + 0.7936177850*lms.y - 0.0040720468*lms.z,
    1.9779984951*lms.x - 2.4285922050*lms.y + 0.4505937099*lms.z,
    0.0259040371*lms.x + 0.7827717662*lms.y - 0.8086757660*lms.z);
}

vec3 oklabToLinear(vec3 lab){
  float l_ = lab.x + 0.3963377774*lab.y + 0.2158037573*lab.z;
  float m_ = lab.x - 0.1055613458*lab.y - 0.0638541728*lab.z;
  float s_ = lab.x - 0.0894841775*lab.y - 1.2914855480*lab.z;
  vec3 lms = vec3(l_*l_*l_, m_*m_*m_, s_*s_*s_);
  return vec3(
     4.0767416621*lms.x - 3.3077115913*lms.y + 0.2309699292*lms.z,
    -1.2684380046*lms.x + 2.6097574011*lms.y - 0.3413193965*lms.z,
    -0.0041960863*lms.x - 0.7034186147*lms.y + 1.7076147010*lms.z);
}

/** perceptually even color mix — the shader equivalent of color-mix(in oklch) */
vec3 mixOk(vec3 a, vec3 b, float t){
  return oklabToLinear(mix(linearToOklab(a), linearToOklab(b), t));
}

vec3 toSRGB(vec3 c){
  return mix(12.92*c, 1.055*pow(max(c, 0.0), vec3(1.0/2.4)) - 0.055, step(0.0031308, c));
}
