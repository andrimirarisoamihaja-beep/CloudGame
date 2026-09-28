import { commonChunks } from "./common.glsl";

/**
 * Aurora borealis: a single curtain plane with additive blending. Vertical
 * streaks come from an fBm that scrolls upward; the band shape is a sine that
 * itself wobbles, so the ribbon never looks like a static decal.
 */
export const auroraVertexShader = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const auroraFragmentShader = /* glsl */ `
precision highp float;

uniform float u_time;
uniform float u_intensity;
uniform vec3 u_colorLow;
uniform vec3 u_colorHigh;

varying vec2 vUv;

${commonChunks}

void main() {
  vec2 p = vUv;
  float t = u_time;

  // A ribbon that sways.
  float sway = sin(p.x * 4.2 + t * 0.21) * 0.055 + fbm(vec3(p.x * 2.4, t * 0.045, 0.0), 3, 2.0, 0.5) * 0.16;
  float centre = 0.46 + sway;
  float band = exp(-pow((p.y - centre) * 6.4, 2.0));
  float band2 = exp(-pow((p.y - centre - 0.14) * 11.0, 2.0)) * 0.5;

  // Vertical curtains.
  float curtains = fbm01(vec3(p.x * 7.0 + t * 0.09, p.y * 1.6 - t * 0.13, t * 0.03), 4, 2.1, 0.55);
  curtains = pow(clamp(curtains, 0.0, 1.0), 1.7);

  float fadeTop = smoothstep(1.0, 0.42, p.y);
  float fadeBottom = smoothstep(0.0, 0.22, p.y);
  float ends = smoothstep(0.0, 0.16, p.x) * smoothstep(1.0, 0.84, p.x);

  float alpha = (band + band2) * curtains * fadeTop * fadeBottom * ends * u_intensity;
  alpha = clamp(alpha, 0.0, 1.0);

  vec3 col = mix(u_colorLow, u_colorHigh, clamp((p.y - 0.1) * 1.5, 0.0, 1.0));
  col += vec3(0.1, 0.25, 0.18) * pow(curtains, 3.0);

  gl_FragColor = vec4(col, alpha);
}
`;
