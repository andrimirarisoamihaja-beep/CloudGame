import { commonChunks } from "./common.glsl";

/**
 * Volumetric cloud — raymarched in the fragment shader.
 *
 * The mesh is a bounding sphere; for each fragment we rebuild the view ray,
 * walk it through the cloud's blob field and accumulate light with
 * front-to-back alpha compositing:
 *
 *   1. the blob field (`blobField`) is a soft union of up to 8 spheres — this is
 *      what sculpting edits;
 *   2. `cloudDensity` erodes that field with 5-octave fBm whose domain drifts
 *      with `u_time`, and the erosion strength is what `u_density` controls
 *      (dense = solid cumulus, thin = cirrus wisp);
 *   3. lighting marches a few steps toward the sun for self-shadowing and adds a
 *      Henyey–Greenstein forward-scatter term for the silver lining.
 *
 * Output is premultiplied (the material sets `premultipliedAlpha`), which makes
 * the blend equation `src + dst * (1 - src.a)` physically correct.
 */
export const cloudFragmentShader = /* glsl */ `
precision highp float;

#define MAX_BLOBS 8
#define MAX_STEPS 64

uniform float u_time;
uniform float u_density;
uniform float u_radius;
uniform vec3 u_center;

uniform vec3 u_lightColor;
uniform vec3 u_shadowColor;
uniform vec3 u_ambientColor;
uniform vec3 u_sunColor;
uniform vec3 u_sunDir;
uniform float u_sunIntensity;

uniform int u_blobCount;
uniform vec4 u_blobs[MAX_BLOBS];
uniform vec3 u_lean;
uniform float u_phase;

uniform float u_noiseScale;
uniform float u_wispiness;
uniform float u_extinction;
uniform float u_selected;
uniform float u_fade;
uniform float u_haze;
uniform int u_steps;
uniform int u_octaves;

varying vec3 vWorldPosition;

${commonChunks}

/** Soft union of every blob: 1 at a blob's core, 0 outside its radius. */
float blobField(vec3 p) {
  float field = 0.0;
  float shearBase = max(u_radius * 0.45, 0.001);
  for (int i = 0; i < MAX_BLOBS; i++) {
    if (i >= u_blobCount) break;
    vec4 blob = u_blobs[i];
    float fi = float(i);
    // Each blob breathes on its own phase so the whole cloud never pulses.
    vec3 wobble = vec3(
      sin(u_time * 0.31 + u_phase + fi * 1.7),
      sin(u_time * 0.23 + u_phase + fi * 2.9),
      cos(u_time * 0.27 + u_phase + fi * 1.3)
    ) * 0.13;
    // Outer blobs lean further downwind than the core: the cloud shears.
    float shear = 0.3 + 0.7 * clamp(length(blob.xyz) / shearBase, 0.0, 1.0);
    vec3 center = blob.xyz + wobble + u_lean * shear;
    float d = length(p - center);
    float h = 1.0 - smoothstep(blob.w * 0.2, blob.w, d);
    field = field + h * (1.0 - field);
  }
  return field;
}

/** Erodes the blob field with animated fBm. 'shape' is the blob field value. */
float cloudDensity(vec3 p, float shape, int octaves) {
  vec3 q = p * u_noiseScale + vec3(u_phase * 5.3, u_phase * 2.1, u_phase * 7.7);
  // The noise domain drifts with time: slow internal movement, never static.
  q += vec3(u_time * 0.042, u_time * -0.017, u_time * 0.029);
  // A single cheap warp octave keeps the silhouette from looking like noise.
  float warp = snoise(q * 0.42 + 17.3);
  q += warp * 0.32;
  float n = fbm01(q, octaves, 2.03, 0.52);
  float erosion = n * mix(1.22, 0.09, u_density) * u_wispiness;
  float d = shape - erosion;
  return clamp(d * (0.55 + 0.8 * u_density), 0.0, 1.0);
}

/** Short march toward the sun for self-shadowing. */
float sunTransmittance(vec3 p, float stepSize) {
  // GLSL ES 1.00 has no integer max(), so clamp the octave count by hand.
  int octaves = u_octaves - 2;
  if (octaves < 1) octaves = 1;
  float density = 0.0;
  float t = stepSize * 0.6;
  for (int i = 0; i < 5; i++) {
    vec3 sp = p + u_sunDir * t;
    float shape = blobField(sp);
    if (shape > 0.015) {
      density += cloudDensity(sp, shape, octaves);
    }
    t += stepSize * 1.35;
  }
  return exp(-density * stepSize * 1.35 * u_extinction * 1.2);
}

void main() {
  // Local space is world space translated to the cloud centre: no rotation,
  // no scale, so directions carry over untouched.
  vec3 ro = cameraPosition - u_center;
  vec3 rd = normalize(vWorldPosition - cameraPosition);

  // Ray / bounding-sphere intersection.
  float b = dot(ro, rd);
  float c = dot(ro, ro) - u_radius * u_radius;
  float disc = b * b - c;
  if (disc < 0.0) discard;
  float sd = sqrt(disc);
  float tNear = -b - sd;
  float tFar = -b + sd;
  float t0 = max(tNear, 0.0);
  if (tFar <= t0) discard;

  float span = tFar - t0;
  float stepSize = span / float(u_steps);
  // Dither the first sample to trade banding for fine grain.
  float jitter = hash12(gl_FragCoord.xy + fract(u_time * 0.37) * 311.0);
  float t = t0 + stepSize * jitter;

  vec3 scattered = vec3(0.0);
  float transmittance = 1.0;
  float cosTheta = dot(rd, u_sunDir);
  float phase = 0.55 + 2.6 * hgPhase(cosTheta, 0.42);

  for (int i = 0; i < MAX_STEPS; i++) {
    if (i >= u_steps || t > tFar || transmittance < 0.02) break;
    vec3 p = ro + rd * t;
    float shape = blobField(p);
    if (shape < 0.02) {
      // Empty pocket: stride ahead without paying for noise.
      t += stepSize * 1.7;
      continue;
    }
    float density = cloudDensity(p, shape, u_octaves);
    if (density > 0.002) {
      float shadow = sunTransmittance(p, stepSize);
      float height = clamp(p.y / max(u_radius, 0.001) * 0.5 + 0.5, 0.0, 1.0);
      vec3 ambient = mix(u_shadowColor, u_ambientColor, height * 0.85);
      vec3 direct = u_lightColor * u_sunIntensity * shadow * phase;
      vec3 lum = ambient + direct;
      // Powder: darken the flat, fully lit faces so they do not read as plastic.
      float powder = 1.0 - exp(-density * 6.0);
      lum *= mix(1.0, powder, 0.32 * (1.0 - shadow));
      float alpha = 1.0 - exp(-density * stepSize * u_extinction);
      scattered += transmittance * lum * alpha;
      transmittance *= 1.0 - alpha;
    }
    t += stepSize;
  }

  float alpha = (1.0 - transmittance) * u_fade;
  if (alpha < 0.004) discard;

  // Aerial perspective: far clouds fade into the sky.
  float viewDistance = length(u_center - cameraPosition);
  float haze = smoothstep(90.0, 340.0, viewDistance) * u_haze;
  scattered = mix(scattered, u_ambientColor * alpha, haze * 0.6);

  // The held cloud carries the faintest warm halo.
  scattered += u_selected * u_sunColor * 0.045 * alpha;

  gl_FragColor = vec4(scattered, alpha);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
