/**
 * Rainbow: a half-torus whose colour is a soft seven-band spectrum running
 * along the arc, fading out at both feet. Blended additively over the sky so it
 * reads as light rather than paint.
 */
export const rainbowVertexShader = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const rainbowFragmentShader = /* glsl */ `
precision highp float;

uniform float u_opacity;
uniform float u_time;

varying vec2 vUv;

float bandAt(float t, float centre, float width) {
  return exp(-pow((t - centre) / width, 2.0));
}

vec3 spectrum(float t) {
  vec3 col = vec3(0.0);
  col += vec3(1.00, 0.42, 0.38) * bandAt(t, 0.04, 0.075);
  col += vec3(1.00, 0.62, 0.36) * bandAt(t, 0.19, 0.075);
  col += vec3(1.00, 0.88, 0.48) * bandAt(t, 0.34, 0.075);
  col += vec3(0.55, 0.93, 0.55) * bandAt(t, 0.49, 0.075);
  col += vec3(0.48, 0.76, 1.00) * bandAt(t, 0.64, 0.075);
  col += vec3(0.56, 0.56, 1.00) * bandAt(t, 0.79, 0.075);
  col += vec3(0.82, 0.58, 1.00) * bandAt(t, 0.94, 0.075);
  return col;
}

void main() {
  float t = vUv.x;
  vec3 col = spectrum(t);

  // Soft falloff across the tube and at both feet of the arch.
  float across = 1.0 - pow(abs(vUv.y * 2.0 - 1.0), 1.6);
  float feet = smoothstep(0.0, 0.10, t) * smoothstep(1.0, 0.90, t);
  float shimmer = 0.92 + 0.08 * sin(u_time * 0.7 + t * 30.0);

  float alpha = u_opacity * feet * shimmer;
  if (alpha < 0.004) discard;

  gl_FragColor = vec4(col * (0.55 + 0.45 * across), alpha * across);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
