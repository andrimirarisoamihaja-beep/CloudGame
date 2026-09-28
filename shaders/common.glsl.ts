/**
 * Shared GLSL chunks: 3D simplex noise, fBm, hashes and colour helpers.
 *
 * The simplex implementation is the classic `webgl-noise` by Ian McEwan /
 * Ashima Arts (MIT). It is inlined as a string so every shader can share it
 * without a build-time GLSL plugin.
 */

export const simplexNoise3D = /* glsl */ `
vec3 cs_mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 cs_mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 cs_permute(vec4 x) { return cs_mod289(((x * 34.0) + 1.0) * x); }
vec4 cs_taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  i = cs_mod289(i);
  vec4 p = cs_permute(cs_permute(cs_permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);

  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  vec4 norm = cs_taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
`;

export const fbmChunk = /* glsl */ `
/** Fractional Brownian motion over simplex noise. 'octaves' is capped at 6. */
float fbm(vec3 p, int octaves, float lacunarity, float gain) {
  float sum = 0.0;
  float amplitude = 0.5;
  float frequency = 1.0;
  float norm = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    sum += amplitude * snoise(p * frequency);
    norm += amplitude;
    frequency *= lacunarity;
    amplitude *= gain;
  }
  return sum / max(norm, 1e-4);
}

/** fBm remapped to 0..1. */
float fbm01(vec3 p, int octaves, float lacunarity, float gain) {
  return fbm(p, octaves, lacunarity, gain) * 0.5 + 0.5;
}
`;

export const hashChunk = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
`;

export const colorChunk = /* glsl */ `
vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

/** Henyey–Greenstein phase — the silver lining when looking toward the sun. */
float hgPhase(float cosTheta, float g) {
  float g2 = g * g;
  float denom = 1.0 + g2 - 2.0 * g * cosTheta;
  return (1.0 - g2) / (12.566370614 * pow(max(denom, 1e-3), 1.5));
}
`;

export const commonChunks = `${simplexNoise3D}\n${fbmChunk}\n${hashChunk}\n${colorChunk}`;
