import { clamp01, uid } from "@/lib/utils";

/**
 * Framework-free data types shared by the client store, the simulation engine,
 * the GLSL uniform writers and the Drizzle schema (which serialises them to
 * `jsonb`). Kept apart from `store.ts` so server code never pulls in zustand.
 */

export interface BlobData {
  position: [number, number, number];
  radius: number;
}

export interface CloudData {
  id: string;
  blobs: BlobData[];
  density: number;
  position: [number, number, number];
}

export type ToolId = "puff" | "shape" | "carve" | "erase";

export type ChallengeId = "first-rain" | "rainbow" | "night-sky" | "storm" | "village-growth";

export const MAX_CLOUDS = 14;
export const MAX_BLOBS = 8;
export const MIN_DENSITY = 0.1;

export const CHALLENGES: Record<ChallengeId, { title: string; subtitle: string }> = {
  "first-rain": { title: "First Rain", subtitle: "Your sky grew heavy enough to water the valley" },
  rainbow: { title: "Rainbow", subtitle: "Sunlight catching the last of the rain" },
  "night-sky": { title: "Night Sky", subtitle: "Five clouds drifting under the stars" },
  storm: { title: "Storm", subtitle: "The sky is letting go" },
  "village-growth": { title: "Village Growth", subtitle: "The valley built another home" },
};

/** Three blobs make a recognisable little cumulus to start sculpting from. */
export function createBlobs(seed = Math.random()): BlobData[] {
  const a = seed * Math.PI * 2;
  return [
    { position: [0, 0, 0], radius: 2.5 },
    { position: [Math.cos(a) * 2.0, -0.4, Math.sin(a) * 1.6], radius: 1.8 },
    { position: [Math.cos(a + 2.5) * 1.8, 0.3, Math.sin(a + 2.5) * 1.7], radius: 1.6 },
  ];
}

export function createCloud(position: [number, number, number], density = 0.62): CloudData {
  return {
    id: uid("cloud"),
    blobs: createBlobs(),
    density: clamp01(density),
    position: [...position] as [number, number, number],
  };
}

/** Radius of the proxy sphere that must contain every blob. */
export function boundingRadiusOf(blobs: BlobData[]): number {
  let radius = 1;
  for (const blob of blobs) {
    const [x, y, z] = blob.position;
    radius = Math.max(radius, Math.hypot(x, y, z) + blob.radius);
  }
  return radius * 1.1;
}

export function blobSpread(blobs: BlobData[]): number {
  if (blobs.length === 0) return 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const blob of blobs) {
    cx += blob.position[0];
    cy += blob.position[1];
    cz += blob.position[2];
  }
  const n = blobs.length;
  cx /= n;
  cy /= n;
  cz /= n;
  let spread = 0;
  for (const blob of blobs) {
    spread += Math.hypot(blob.position[0] - cx, blob.position[1] - cy, blob.position[2] - cz);
  }
  return spread / n;
}

/** Coarse measure of how much sky a cloud occupies — drives audio volume. */
export function cloudMass(cloud: CloudData): number {
  let total = 0;
  for (const blob of cloud.blobs) total += blob.radius ** 3;
  return clamp01(total / 320);
}

/** Normalises untrusted input (a saved sky, a URL payload) into safe data. */
export function sanitizeClouds(input: unknown): CloudData[] {
  if (!Array.isArray(input)) return [];
  const clouds: CloudData[] = [];
  for (const raw of input.slice(0, MAX_CLOUDS)) {
    if (!raw || typeof raw !== "object") continue;
    const candidate = raw as Record<string, unknown>;
    const position = Array.isArray(candidate.position) ? candidate.position : [0, 24, 0];
    const density = typeof candidate.density === "number" ? candidate.density : 0.6;
    const blobsSource = Array.isArray(candidate.blobs) ? candidate.blobs : [];
    const blobs: BlobData[] = [];
    for (const rawBlob of blobsSource.slice(0, MAX_BLOBS)) {
      if (!rawBlob || typeof rawBlob !== "object") continue;
      const blob = rawBlob as Record<string, unknown>;
      const blobPosition = Array.isArray(blob.position) ? blob.position : [0, 0, 0];
      blobs.push({
        position: [
          Number.isFinite(Number(blobPosition[0])) ? Number(blobPosition[0]) : 0,
          Number.isFinite(Number(blobPosition[1])) ? Number(blobPosition[1]) : 0,
          Number.isFinite(Number(blobPosition[2])) ? Number(blobPosition[2]) : 0,
        ],
        radius: Math.min(9, Math.max(0.4, Number(blob.radius) || 1.5)),
      });
    }
    if (blobs.length === 0) continue;
    clouds.push({
      id: typeof candidate.id === "string" ? candidate.id : uid("cloud"),
      density: clamp01(Number(density) || 0),
      position: [
        Math.max(-110, Math.min(110, Number(position[0]) || 0)),
        Math.max(12, Math.min(76, Number(position[1]) || 26)),
        Math.max(-70, Math.min(70, Number(position[2]) || 0)),
      ],
      blobs,
    });
  }
  return clouds;
}
