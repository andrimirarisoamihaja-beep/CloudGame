/**
 * Cloud proxy vertex shader.
 *
 * The mesh is only a bounding sphere: every real decision (where the cloud is,
 * what shape it has) happens in the fragment shader, which raymarches the blob
 * field between the ray/sphere intersections. We only need the world position
 * here so the fragment can rebuild the view ray.
 */
export const cloudVertexShader = /* glsl */ `
varying vec3 vWorldPosition;

void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;
