"use client";

import { Color, Vector3 } from "three";
import { clamp, clamp01, damp } from "@/lib/utils";
import { WEATHER_PROFILES, type WeatherName, type WeatherProfile, sampleWind } from "@/lib/weather";
import type { BlobData, CloudData } from "@/lib/types";
import { boundingRadiusOf } from "@/lib/types";
import { LAKE_SURFACE, terrainHeight } from "@/lib/terrain";

/**
 * The hot-path simulation state.
 *
 * Everything that changes every frame lives here as plain mutable data instead
 * of React state: a single driver (`WeatherSystem`) advances it in one `useFrame`
 * pass and every 3D component reads it directly. React only re-renders when the
 * *structure* of the scene changes (a cloud is born, merges or dissolves) or when
 * a throttled snapshot is committed to the zustand store for the HUD.
 */

export interface RuntimeCloud {
  id: string;
  /** Authored shape — mutated in place while sculpting, persisted on commit. */
  blobs: BlobData[];
  density: number;
  position: [number, number, number];
  /** Cached bounding radius of the proxy sphere (world units). */
  boundingRadius: number;
  /** Wind lean applied to every blob, bounded and elastic. */
  lean: [number, number, number];
  /** Independent phase so clouds never breathe in lockstep. */
  phase: number;
  /** Smoothed 0–1 precipitation of this cloud. */
  rain: number;
  /** Smoothed 0–1 selection highlight. */
  glow: number;
  /** Spawn-in fade so clouds materialise instead of popping. */
  fade: number;
  /** Round (1) ↔ stretched (0), drives the cloud's own resonance tone. */
  roundness: number;
  /** Total size, drives that tone's volume. */
  mass: number;
  /** Ground height beneath the cloud centre. */
  groundY: number;
  /** Set when sculpting dirtied the authored shape and the store needs a sync. */
  dirty: boolean;
}

export interface SimState {
  /** Seconds since the scene started (scaled by the day/night speed). */
  time: number;
  /** 0 = midnight, 0.5 = noon, 1 = midnight. */
  timeOfDay: number;
  paused: boolean;
  /** Minutes 0–1440, for persistence. */
  minutes: number;

  sunDir: Vector3;
  sunElevation: number;
  moonDir: Vector3;
  /** Direction the clouds are lit from: the sun by day, the moon by night. */
  cloudSunDir: Vector3;

  /** Lighting shared by the cloud shader, the sky and the landscape. */
  lightColor: Color;
  shadowColor: Color;
  ambientColor: Color;
  groundColor: Color;
  sunColor: Color;
  sunIntensity: number;
  ambientIntensity: number;
  /** Exposure suggested by the active sky palette (bright noon, dim night). */
  paletteExposure: number;
  /** Fraction of the dome covered by cloud, 0–1. */
  cloudCover: number;

  /** Adaptive quality: the raymarcher is the most expensive thing on screen. */
  quality: number;
  steps: number;
  octaves: number;
  dpr: number;
  frameMs: number;

  weather: WeatherName;
  nextWeather: WeatherName;
  profile: WeatherProfile;
  stateAge: number;
  stateDuration: number;
  transition: number;

  humidity: number;
  windAngle: number;
  windStrength: number;
  wind: Vector3;
  overcast: number;
  rainIntensity: number;
  isRaining: boolean;
  secondsSinceRain: number;

  /** Lightning flash 0–1, decays over ~0.3s. */
  flash: number;
  /** Rainbow fade 0–1. */
  rainbow: number;
  /** Aurora fade 0–1. */
  aurora: number;
  /** Fireflies / window lights, 0–1. */
  nightLights: number;

  /** Accumulated rainfall, drives landscape growth. */
  rainTotal: number;
  growth: number;
  housesBuilt: number;
  treesGrown: number;

  /** Ring buffer of ground positions struck by rain in the last frames. */
  rainHits: { x: Float32Array; z: Float32Array; head: number; count: number };

  clouds: Map<string, RuntimeCloud>;
  /** Clouds currently precipitating, recomputed each frame. */
  rainingCloudIds: string[];
  /** Mirrors the store's selection for the shader's highlight. */
  selectedId: string | null;

  /** Bumped whenever lightning strikes so the audio engine can react. */
  thunderToken: number;
  lastThunderAt: number;
}

const RAIN_HIT_CAPACITY = 192;

export const sim: SimState = {
  time: 0,
  timeOfDay: 0.3,
  paused: false,
  minutes: 432,

  sunDir: new Vector3(0.35, 0.85, -0.3).normalize(),
  sunElevation: 0.85,
  moonDir: new Vector3(-0.35, -0.85, 0.3).normalize(),
  cloudSunDir: new Vector3(0.35, 0.85, -0.3).normalize(),

  lightColor: new Color(1, 0.97, 0.9),
  shadowColor: new Color(0.42, 0.48, 0.62),
  ambientColor: new Color(0.62, 0.74, 0.9),
  groundColor: new Color(0.16, 0.2, 0.15),
  sunColor: new Color(1, 0.97, 0.9),
  sunIntensity: 1.1,
  ambientIntensity: 0.55,
  paletteExposure: 1,
  cloudCover: 0,

  quality: 1,
  steps: 34,
  octaves: 5,
  dpr: 1.25,
  frameMs: 16,

  weather: "CLEAR",
  nextWeather: "CLOUDY",
  profile: { ...WEATHER_PROFILES.CLEAR },
  stateAge: 0,
  stateDuration: 45,
  transition: 0,

  humidity: 0.35,
  windAngle: 0,
  windStrength: 0.25,
  wind: new Vector3(1, 0, 0.1).normalize(),
  overcast: 0,
  rainIntensity: 0,
  isRaining: false,
  secondsSinceRain: 999,

  flash: 0,
  rainbow: 0,
  aurora: 0,
  nightLights: 0,

  rainTotal: 0,
  growth: 0,
  housesBuilt: 5,
  treesGrown: 0,

  rainHits: {
    x: new Float32Array(RAIN_HIT_CAPACITY),
    z: new Float32Array(RAIN_HIT_CAPACITY),
    head: 0,
    count: 0,
  },

  clouds: new Map<string, RuntimeCloud>(),
  rainingCloudIds: [],
  selectedId: null,
  thunderToken: 0,
  lastThunderAt: -999,
};

/** ---------------------------------------------------------------------------
 * Cloud runtime bookkeeping
 * ------------------------------------------------------------------------- */

function makeRuntime(cloud: CloudData, index: number): RuntimeCloud {
  const runtime: RuntimeCloud = {
    id: cloud.id,
    blobs: cloud.blobs.map((blob) => ({
      position: [...blob.position] as [number, number, number],
      radius: blob.radius,
    })),
    density: cloud.density,
    position: [...cloud.position] as [number, number, number],
    boundingRadius: boundingRadiusOf(cloud.blobs),
    lean: [0, 0, 0],
    phase: index * 1.7 + Math.random() * 2.4,
    rain: 0,
    glow: 0,
    fade: 0,
    roundness: 0.5,
    mass: 1,
    groundY: terrainHeight(cloud.position[0], cloud.position[2]),
    dirty: false,
  };
  measure(runtime);
  return runtime;
}

/** Recomputes the cheap shape metrics used by audio, rain and the bounding box. */
export function measure(runtime: RuntimeCloud): void {
  let cx = 0;
  let cy = 0;
  let cz = 0;
  let volume = 0;
  for (const blob of runtime.blobs) {
    cx += blob.position[0];
    cy += blob.position[1];
    cz += blob.position[2];
    volume += blob.radius ** 3;
  }
  const n = runtime.blobs.length || 1;
  cx /= n;
  cy /= n;
  cz /= n;

  let spread = 0;
  let radiusSum = 0;
  for (const blob of runtime.blobs) {
    spread += Math.hypot(blob.position[0] - cx, blob.position[1] - cy, blob.position[2] - cz);
    radiusSum += blob.radius;
  }
  const meanRadius = radiusSum / n || 1;
  const meanSpread = spread / n;
  // A compact cloud has blobs packed near the centre; a stretched one does not.
  runtime.roundness = clamp01(1 - meanSpread / (meanRadius * 2.6));
  runtime.mass = clamp01(volume / 260);
  runtime.boundingRadius = boundingRadiusOf(runtime.blobs);
}

/** Reconciles the runtime map with the authoritative store array. */
export function syncClouds(clouds: CloudData[]): void {
  const seen = new Set<string>();
  for (let index = 0; index < clouds.length; index += 1) {
    const cloud = clouds[index];
    seen.add(cloud.id);
    const existing = sim.clouds.get(cloud.id);
    if (!existing) {
      sim.clouds.set(cloud.id, makeRuntime(cloud, index));
      continue;
    }
    // While the player is sculpting, the runtime is authoritative: never let a
    // stale store value interrupt a live drag. Otherwise the store wins, which
    // is how loading a saved sky (or a merge) reaches the shader.
    if (existing.dirty) continue;

    let differs = existing.blobs.length !== cloud.blobs.length;
    if (!differs) {
      for (let i = 0; i < cloud.blobs.length; i += 1) {
        const a = existing.blobs[i];
        const b = cloud.blobs[i];
        if (
          Math.abs(a.radius - b.radius) > 1e-4 ||
          Math.abs(a.position[0] - b.position[0]) > 1e-4 ||
          Math.abs(a.position[1] - b.position[1]) > 1e-4 ||
          Math.abs(a.position[2] - b.position[2]) > 1e-4
        ) {
          differs = true;
          break;
        }
      }
    }
    if (differs) {
      existing.blobs = cloud.blobs.map((blob) => ({
        position: [...blob.position] as [number, number, number],
        radius: blob.radius,
      }));
      measure(existing);
    }

    if (Math.abs(existing.density - cloud.density) > 1e-4) {
      existing.density = cloud.density;
    }
    if (
      Math.abs(existing.position[0] - cloud.position[0]) > 1e-3 ||
      Math.abs(existing.position[1] - cloud.position[1]) > 1e-3 ||
      Math.abs(existing.position[2] - cloud.position[2]) > 1e-3
    ) {
      existing.position = [...cloud.position] as [number, number, number];
      existing.groundY = terrainHeight(existing.position[0], existing.position[2]);
    }
  }

  for (const id of Array.from(sim.clouds.keys())) {
    if (!seen.has(id)) sim.clouds.delete(id);
  }
}

export function getRuntime(id: string): RuntimeCloud | undefined {
  return sim.clouds.get(id);
}

/** Serialises the runtime shapes back into plain data for saving / persisting. */
export function snapshotClouds(): CloudData[] {
  return Array.from(sim.clouds.values()).map((runtime) => ({
    id: runtime.id,
    density: clamp01(runtime.density),
    position: [...runtime.position] as [number, number, number],
    blobs: runtime.blobs.map((blob) => ({
      position: [...blob.position] as [number, number, number],
      radius: blob.radius,
    })),
  }));
}

/** ---------------------------------------------------------------------------
 * Wind, rain hits, lightning
 * ------------------------------------------------------------------------- */

const windSample = { angle: 0, strength: 0 };

export function updateWind(time: number): void {
  sampleWind(time, windSample);
  sim.windAngle = windSample.angle;
  const gust = windSample.strength;
  sim.windStrength = clamp01(gust * (0.45 + sim.profile.wind));
  sim.wind.set(Math.cos(sim.windAngle), 0, Math.sin(sim.windAngle)).normalize();
}

/**
 * Pushes every cloud downwind and leans its blobs. The lean is elastic so a
 * gust stretches a cloud and a lull lets it settle back.
 */
export function driftClouds(dt: number): void {
  const drift = sim.profile.drift * sim.windStrength;
  for (const runtime of sim.clouds.values()) {
    const wx = sim.wind.x * drift;
    const wz = sim.wind.z * drift;

    // Whole-cloud travel, wrapped at the far horizon.
    runtime.position[0] += wx * dt * 0.55;
    runtime.position[2] += wz * dt * 0.55;
    if (runtime.position[0] > 120) runtime.position[0] = -120;
    if (runtime.position[0] < -120) runtime.position[0] = 120;
    if (runtime.position[2] > 70) runtime.position[2] = -70;
    if (runtime.position[2] < -70) runtime.position[2] = 70;

    // Elastic lean of the blobs themselves.
    const targetLeanX = wx * 0.9;
    const targetLeanZ = wz * 0.9;
    runtime.lean[0] = damp(runtime.lean[0], clamp(targetLeanX, -2.6, 2.6), 1.1, dt);
    runtime.lean[2] = damp(runtime.lean[2], clamp(targetLeanZ, -2.6, 2.6), 1.1, dt);
    runtime.lean[1] = damp(runtime.lean[1], -sim.windStrength * 0.25, 0.8, dt);

    // Very gentle buoyancy: thick clouds rise, thin ones sink a little.
    const buoyancy = (runtime.density - 0.55) * 0.35 - runtime.rain * 0.9;
    runtime.position[1] = clamp(
      runtime.position[1] + buoyancy * dt,
      runtime.groundY + 14,
      78,
    );
    runtime.groundY = damp(runtime.groundY, terrainHeight(runtime.position[0], runtime.position[2]), 0.5, dt);
  }
}

export function pushRainHit(x: number, z: number): void {
  const buffer = sim.rainHits;
  buffer.x[buffer.head] = x;
  buffer.z[buffer.head] = z;
  buffer.head = (buffer.head + 1) % RAIN_HIT_CAPACITY;
  buffer.count = Math.min(buffer.count + 1, RAIN_HIT_CAPACITY);
}

export function strikeLightning(strength = 1): void {
  sim.flash = Math.min(1.35, sim.flash + strength);
  sim.thunderToken += 1;
  sim.lastThunderAt = sim.time;
}

/** Fraction of the sky covered by cloud — feeds the sky shader's overcast term. */
export function computeCloudCover(): number {
  let cover = 0;
  for (const runtime of sim.clouds.values()) {
    cover += (runtime.boundingRadius * runtime.boundingRadius * runtime.density) / 900;
  }
  return clamp01(cover);
}

export function waterLevel(): number {
  return LAKE_SURFACE;
}

/** ---------------------------------------------------------------------------
 * Adaptive quality
 * ------------------------------------------------------------------------- */

interface QualityLevel {
  quality: number;
  steps: number;
  octaves: number;
  dpr: number;
}

const QUALITY_LEVELS: QualityLevel[] = [
  { quality: 0.34, steps: 20, octaves: 3, dpr: 0.85 },
  { quality: 0.67, steps: 26, octaves: 4, dpr: 1.0 },
  { quality: 1.0, steps: 34, octaves: 5, dpr: 1.25 },
];

let qualityCooldown = 0;
let levelIndex = QUALITY_LEVELS.length - 1;

/**
 * Watches frame time and walks the raymarcher down (or back up) a quality
 * ladder. Cloud sculpting should feel the same on a laptop and on a phone — it
 * just gets a little softer on the slow ones.
 */
export function updateQuality(dt: number): void {
  const ms = dt * 1000;
  sim.frameMs = sim.frameMs * 0.92 + ms * 0.08;
  qualityCooldown -= dt;
  if (qualityCooldown > 0) return;

  if (sim.frameMs > 27 && levelIndex > 0) {
    levelIndex -= 1;
    qualityCooldown = 2.5;
  } else if (sim.frameMs < 12.5 && levelIndex < QUALITY_LEVELS.length - 1) {
    levelIndex += 1;
    qualityCooldown = 5;
  } else {
    return;
  }

  const level = QUALITY_LEVELS[levelIndex];
  sim.quality = level.quality;
  sim.steps = level.steps;
  sim.octaves = level.octaves;
  sim.dpr = level.dpr;
}

export function currentDpr(): number {
  return sim.dpr;
}
