// Node body — hex prism. Object-space position + normal so the field is anchored to the node.
varying vec3 vLocal;
varying vec3 vNormalO;
varying vec2 vUv;
void main(){
  vUv = uv;
  vLocal = position;
  vNormalO = normal;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
