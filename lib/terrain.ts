import { fbm3, scatterNoise, terrainNoise } from "@/lib/noise";
import { clamp01, mulberry32, smoothstep } from "@/lib/utils";

/**
 * The miniature landscape is one shared height field: the terrain mesh, the tree
 * and house placement, the rain splashes and the flower growth all read it, so
 * everything sits exactly on the ground.
 */

export const TERRAIN_SIZE = 260;
export const TERRAIN_SEGMENTS = 128;
export const LAKE_CENTER: [number, number] = [26, -14];
export const LAKE_RADIUS = 26;
export const LAKE_SURFACE = -1.35;
export const VILLAGE_CENTER: [number, number] = [-22, -6];

/** Height of the ground at a world position (metres, y-up). */
export function terrainHeight(x: number, z: number): number {
  const rolling = fbm3(terrainNoise, x * 0.0125, 0.0, z * 0.0125, 4) * 7.0;
  const detail = fbm3(terrainNoise, x * 0.055, 3.1, z * 0.055, 3) * 1.15;
  let h = rolling + detail - 1.2;

  // A soft basin holds the lake.
  const lakeDistance = Math.hypot(x - LAKE_CENTER[0], z - LAKE_CENTER[1]);
  h -= 6.4 * Math.exp(-(lakeDistance * lakeDistance) / (2 * 19 * 19));

  // The village sits on a gentle terrace.
  const villageDistance = Math.hypot(x - VILLAGE_CENTER[0], z - VILLAGE_CENTER[1]);
  h = h * (1 - 0.78 * Math.exp(-(villageDistance * villageDistance) / (2 * 24 * 24))) + 0.35;

  // Distant hills close the horizon.
  const radial = Math.hypot(x, z);
  h += smoothstep(58, 128, radial) * 17.5;

  return h;
}

/** Downward slope magnitude — used to keep trees off cliff faces. */
export function terrainSlope(x: number, z: number): number {
  const d = 1.4;
  const hx = terrainHeight(x + d, z) - terrainHeight(x - d, z);
  const hz = terrainHeight(x, z + d) - terrainHeight(x, z - d);
  return Math.hypot(hx, hz) / (2 * d);
}

export function isUnderwater(x: number, z: number): boolean {
  const lakeDistance = Math.hypot(x - LAKE_CENTER[0], z - LAKE_CENTER[1]);
  return lakeDistance < LAKE_RADIUS * 0.86 && terrainHeight(x, z) < LAKE_SURFACE;
}

/** Deterministic scatter: returns candidate ground positions in a ring/area. */
export function scatterPoints(
  count: number,
  options: {
    seed: number;
    radius: [number, number];
    center?: [number, number];
    minSlope?: number;
    underwater?: boolean;
  },
): Array<[number, number, number]> {
  const { seed, radius, center = [0, 0], minSlope = 0.55, underwater = false } = options;
  const random = mulberry32(seed);
  const points: Array<[number, number, number]> = [];
  let guard = 0;
  while (points.length < count && guard < count * 60) {
    guard += 1;
    const angle = random() * Math.PI * 2;
    const distance = radius[0] + Math.sqrt(random()) * (radius[1] - radius[0]);
    const x = center[0] + Math.cos(angle) * distance;
    const z = center[1] + Math.sin(angle) * distance;
    const y = terrainHeight(x, z);
    if (!underwater && (y < LAKE_SURFACE + 0.25 || terrainSlope(x, z) > minSlope)) continue;
    if (underwater && y > LAKE_SURFACE - 0.2) continue;
    points.push([x, y, z]);
  }
  return points;
}

/** Flower patches cluster on the near shore, where the player will notice them. */
export function flowerPatches(count: number): Array<[number, number, number]> {
  const random = mulberry32(5150);
  const patches: Array<[number, number, number]> = [];
  let guard = 0;
  while (patches.length < count && guard < count * 80) {
    guard += 1;
    const angle = random() * Math.PI * 2;
    const distance = 14 + Math.sqrt(random()) * 46;
    const x = Math.cos(angle) * distance;
    const z = Math.sin(angle) * distance * 0.8 + 6;
    const y = terrainHeight(x, z);
    if (y < LAKE_SURFACE + 0.4 || terrainSlope(x, z) > 0.4) continue;
    patches.push([x, y, z]);
  }
  return patches;
}

/** Extra noise for colour variation, kept in [0,1]. */
export function terrainTint(x: number, z: number): number {
  return clamp01(fbm3(terrainNoise, x * 0.02 + 40, 9.7, z * 0.02 - 12, 3) * 0.5 + 0.5) *
    clamp01(1 - scatterNoise(x * 0.05, z * 0.05) * 0.25);
}
