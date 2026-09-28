/**
 * Sky dome vertex shader. The dome is a large inverted sphere centred on the
 * world origin; we only forward the world-space direction of each fragment.
 */
export const skyVertexShader = /* glsl */ `
varying vec3 vWorldPosition;

void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;
