// Fullscreen pass vertex shader. Use with PlaneGeometry(2,2) and an
// OrthographicCamera(-1,1,1,-1,0,1) — no matrices needed.
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = vec4(position, 1.0);
}
