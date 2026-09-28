import { commonChunks } from "./common.glsl";
import { SKY_KEYFRAMES } from "@/lib/weather";

/**
 * Sky dome: a five-keyframe gradient driven by `u_timeOfDay`, plus a sun disc
 * with atmospheric bloom, a noise-threshold star field, a moon, a lightning
 * flash term and an overcast desaturation.
 *
 * The colour keyframes are injected straight from `SKY_KEYFRAMES` in
 * `lib/weather.ts`, so the shader and the JS lights can never disagree.
 */

const glslVec3 = (c: readonly [number, number, number]) =>
  `vec3(${c[0].toFixed(4)}, ${c[1].toFixed(4)}, ${c[2].toFixed(4)})`;

const keyframes = SKY_KEYFRAMES.map(
  (palette, index) => `
const vec3 K${index}_ZENITH = ${glslVec3(palette.zenith)};
const vec3 K${index}_HORIZON = ${glslVec3(palette.horizon)};
const vec3 K${index}_SUN = ${glslVec3(palette.sun)};
const vec3 K${index}_GROUND = ${glslVec3(palette.ground)};
const float K${index}_STAR = ${palette.star.toFixed(3)};`,
).join("\n");

export const skyFragmentShader = /* glsl */ `
precision highp float;

uniform float u_time;
uniform float u_timeOfDay;
uniform vec3 u_sunDir;
uniform vec3 u_moonDir;
uniform float u_flash;
uniform float u_overcast;
uniform float u_cloudCover;
uniform float u_exposure;

varying vec3 vWorldPosition;

${commonChunks}

${keyframes}

void main() {
  vec3 dir = normalize(vWorldPosition - cameraPosition);
  float t = fract(u_timeOfDay);

  // --- gradient ------------------------------------------------------------
  vec3 zenith = mix(K0_ZENITH, K1_ZENITH, smoothstep(0.14, 0.24, t));
  zenith = mix(zenith, K2_ZENITH, smoothstep(0.26, 0.34, t));
  zenith = mix(zenith, K3_ZENITH, smoothstep(0.64, 0.74, t));
  zenith = mix(zenith, K4_ZENITH, smoothstep(0.80, 0.90, t));

  vec3 horizon = mix(K0_HORIZON, K1_HORIZON, smoothstep(0.14, 0.24, t));
  horizon = mix(horizon, K2_HORIZON, smoothstep(0.26, 0.34, t));
  horizon = mix(horizon, K3_HORIZON, smoothstep(0.64, 0.74, t));
  horizon = mix(horizon, K4_HORIZON, smoothstep(0.80, 0.90, t));

  vec3 ground = mix(K0_GROUND, K1_GROUND, smoothstep(0.14, 0.26, t));
  ground = mix(ground, K2_GROUND, smoothstep(0.28, 0.36, t));
  ground = mix(ground, K3_GROUND, smoothstep(0.62, 0.72, t));
  ground = mix(ground, K4_GROUND, smoothstep(0.80, 0.90, t));

  float starAmount = mix(K0_STAR, K1_STAR, smoothstep(0.14, 0.24, t));
  starAmount = mix(starAmount, K2_STAR, smoothstep(0.26, 0.34, t));
  starAmount = mix(starAmount, K3_STAR, smoothstep(0.64, 0.74, t));
  starAmount = mix(starAmount, K4_STAR, smoothstep(0.80, 0.90, t));

  vec3 sunColor = mix(K0_SUN, K1_SUN, smoothstep(0.14, 0.24, t));
  sunColor = mix(sunColor, K2_SUN, smoothstep(0.26, 0.34, t));
  sunColor = mix(sunColor, K3_SUN, smoothstep(0.64, 0.74, t));
  sunColor = mix(sunColor, K4_SUN, smoothstep(0.80, 0.90, t));

  // --- base sky ------------------------------------------------------------
  float up = pow(clamp(dir.y, 0.0, 1.0), 0.62);
  vec3 col = mix(horizon, zenith, up);
  col = mix(col, ground, smoothstep(0.02, -0.18, dir.y));

  float sunUp = smoothstep(-0.16, 0.06, u_sunDir.y);
  float cosSun = dot(dir, u_sunDir);

  // Warm airmass around the horizon, strongest near the sun's azimuth.
  float airmass = exp(-abs(dir.y) * 7.5);
  col += sunColor * airmass * (0.05 + 0.16 * pow(max(cosSun, 0.0), 3.0)) * (0.35 + 0.65 * sunUp);

  // Sun disc + bloom.
  float disc = smoothstep(0.99955, 0.99985, cosSun);
  float bloom = pow(max(cosSun, 0.0), 260.0) * 0.55 + pow(max(cosSun, 0.0), 9.0) * 0.14;
  col += sunColor * (disc * 4.0 + bloom) * sunUp;

  // --- stars ---------------------------------------------------------------
  if (starAmount > 0.002) {
    vec3 sd = dir * 95.0;
    float n1 = snoise(sd);
    float n2 = snoise(dir * 265.0 + 13.7);
    float star = smoothstep(0.60, 0.76, n1) * smoothstep(0.52, 0.86, n2 + 0.28);
    float twinkle = 0.62 + 0.38 * sin(u_time * 1.9 + n1 * 47.0);
    star *= twinkle * smoothstep(-0.02, 0.30, dir.y) * starAmount;
    col += vec3(0.92, 0.95, 1.0) * star * 0.95;
  }

  // --- moon ----------------------------------------------------------------
  float moonUp = smoothstep(-0.05, 0.12, u_moonDir.y);
  if (moonUp > 0.001) {
    float cosMoon = dot(dir, u_moonDir);
    float moonDisc = smoothstep(0.99930, 0.99972, cosMoon);
    float moonHalo = pow(max(cosMoon, 0.0), 620.0) * 0.5 + pow(max(cosMoon, 0.0), 40.0) * 0.06;
    col += vec3(0.93, 0.95, 1.0) * (moonDisc * 1.9 + moonHalo) * moonUp * (0.35 + 0.65 * starAmount);
  }

  // --- weather -------------------------------------------------------------
  // Overcast: desaturate and dim, but keep a soft blue-grey rather than mud.
  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  vec3 grey = vec3(luma) * vec3(0.86, 0.9, 1.0) * 0.66;
  col = mix(col, grey, clamp(u_overcast * 0.82, 0.0, 0.9));
  col *= 1.0 - clamp(u_cloudCover, 0.0, 1.0) * 0.1;

  // Lightning.
  col += vec3(0.72, 0.78, 1.0) * u_flash * (0.30 + 0.70 * smoothstep(-0.25, 0.55, dir.y));

  col *= u_exposure;

  // Break up 8-bit banding across the very smooth gradient.
  col += (hash12(gl_FragCoord.xy + fract(u_time) * 137.0) - 0.5) / 220.0;

  gl_FragColor = vec4(col, 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
