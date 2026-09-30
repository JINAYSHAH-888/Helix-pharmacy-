// Mesh vertex shader with velocity bend + normals for the glass/refraction pass.
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vViewPosition;

uniform float uVelocity;
uniform float uBend;      // 0 = flat

void main(){
  vUv = uv;
  vec3 p = position;

  // bend the plane in the middle, proportional to scroll velocity
  p.z += sin(uv.x * 3.141592653589793) * uVelocity * uBend;

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vViewPosition = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}
