import { clamp, clamp01, damp, lerp } from "@/lib/utils";
import { fbm2, gustNoise, windNoise } from "@/lib/noise";

/**
 * The weather state machine.
 *
 *   CLEAR → CLOUDY → OVERCAST → RAIN → STORM → CLEAR
 *
 * Each state owns a target profile (humidity, wind, rain, lightning chance).
 * Transitions are randomised (30–90s) and *interpolated*: nothing snaps, the
 * simulation eases toward the active profile so the sky always feels alive.
 */

export const WEATHER_STATES = ["CLEAR", "CLOUDY", "OVERCAST", "RAIN", "STORM"] as const;
export type WeatherName = (typeof WEATHER_STATES)[number];

export interface WeatherProfile {
  /** Target humidity, 0–1. */
  humidity: number;
  /** Target wind strength, 0–1. */
  wind: number;
  /** How much the sky greys over, 0–1. */
  overcast: number;
  /** Rainfall rate, 0–1. */
  rain: number;
  /** Lightning strikes per second at full intensity. */
  lightning: number;
  /** How strongly clouds are nudged in the wind direction. */
  drift: number;
  /** Ambient pad brightness, 0–1. */
  mood: number;
}

export const WEATHER_PROFILES: Record<WeatherName, WeatherProfile> = {
  CLEAR: { humidity: 0.22, wind: 0.18, overcast: 0.0, rain: 0.0, lightning: 0.0, drift: 0.35, mood: 0.55 },
  CLOUDY: { humidity: 0.55, wind: 0.32, overcast: 0.35, rain: 0.0, lightning: 0.0, drift: 0.7, mood: 0.7 },
  OVERCAST: { humidity: 0.78, wind: 0.45, overcast: 0.78, rain: 0.0, lightning: 0.0, drift: 1.0, mood: 0.8 },
  RAIN: { humidity: 0.92, wind: 0.55, overcast: 0.92, rain: 0.7, lightning: 0.02, drift: 1.25, mood: 0.9 },
  STORM: { humidity: 1.0, wind: 0.95, overcast: 1.0, rain: 1.0, lightning: 0.16, drift: 1.8, mood: 1.0 },
};

/** Serializable snapshot stored alongside a saved sky. */
export interface WeatherSnapshot {
  state: WeatherName;
  humidity: number;
  windStrength: number;
  windDirection: [number, number, number];
  rainIntensity: number;
  overcast: number;
  isRaining: boolean;
}

export function isWeatherName(value: unknown): value is WeatherName {
  return typeof value === "string" && (WEATHER_STATES as readonly string[]).includes(value);
}

/** The next state in the cycle. */
export function nextWeatherState(current: WeatherName): WeatherName {
  const index = WEATHER_STATES.indexOf(current);
  return WEATHER_STATES[(index + 1) % WEATHER_STATES.length];
}

/** A state dwell time between 30 and 90 seconds. */
export function randomTransitionDelay(random: () => number = Math.random): number {
  return 30 + random() * 60;
}

/**
 * Wind is a slowly rotating vector driven by fBm: the direction wanders and the
 * strength breathes, with an occasional gust. Pure function of time so it can be
 * evaluated from anywhere (and replayed deterministically from a seed).
 */
export function sampleWind(time: number, out: { angle: number; strength: number }): void {
  const wander = fbm2(windNoise, time * 0.035, 12.7, 3);
  const gust = Math.max(0, fbm2(gustNoise, time * 0.11, 3.3, 2));
  out.angle = wander * Math.PI * 1.35 + Math.sin(time * 0.017) * 0.5;
  out.strength = clamp01(0.18 + gust * 0.9);
}

/** Human-readable, non-emoji labels for the HUD tooltip. */
export function describeWeather(state: WeatherName): string {
  switch (state) {
    case "CLEAR":
      return "Clear";
    case "CLOUDY":
      return "Cloudy";
    case "OVERCAST":
      return "Overcast";
    case "RAIN":
      return "Rain";
    case "STORM":
      return "Storm";
    default:
      return "Clear";
  }
}

/**
 * Eases a live profile toward the target profile. `rate` is the approach speed
 * (higher = snappier weather changes).
 */
export function approachProfile(
  current: WeatherProfile,
  target: WeatherProfile,
  dt: number,
  rate = 0.35,
): void {
  current.humidity = damp(current.humidity, target.humidity, rate, dt);
  current.wind = damp(current.wind, target.wind, rate, dt);
  current.overcast = damp(current.overcast, target.overcast, rate, dt);
  current.rain = damp(current.rain, target.rain, rate, dt);
  current.lightning = damp(current.lightning, target.lightning, rate, dt);
  current.drift = damp(current.drift, target.drift, rate, dt);
  current.mood = damp(current.mood, target.mood, rate, dt);
}

export function blendProfiles(a: WeatherProfile, b: WeatherProfile, t: number): WeatherProfile {
  const k = clamp01(t);
  return {
    humidity: lerp(a.humidity, b.humidity, k),
    wind: lerp(a.wind, b.wind, k),
    overcast: lerp(a.overcast, b.overcast, k),
    rain: lerp(a.rain, b.rain, k),
    lightning: lerp(a.lightning, b.lightning, k),
    drift: lerp(a.drift, b.drift, k),
    mood: lerp(a.mood, b.mood, k),
  };
}

export function cloneProfile(profile: WeatherProfile): WeatherProfile {
  return { ...profile };
}

/**
 * A cloud starts raining when the air is saturated enough and the cloud is
 * thick enough to hold water.
 */
export function cloudRains(humidity: number, density: number): boolean {
  return humidity > 0.8 && density > 0.6;
}

/**
 * Rainbows need two things at once: rain that has *just* stopped and a low sun
 * (the lower third of the sky).
 */
export function rainbowVisible(secondsSinceRain: number, sunElevation: number): boolean {
  return secondsSinceRain < 14 && sunElevation > 0.04 && sunElevation < 0.34;
}

/** Aurora needs a genuinely dark sky and dry, thin air. */
export function auroraVisible(timeOfDay: number, humidity: number): boolean {
  const night = timeOfDay < 0.22 || timeOfDay > 0.78;
  return night && humidity < 0.3;
}

/**
 * Sky palette keyframes for the day/night cycle, shared by the GLSL sky shader
 * and by the JS side (lights, fog, UI accents) so both stay in sync.
 * `timeOfDay` runs 0 (midnight) → 0.5 (noon) → 1 (midnight).
 */
export interface SkyPalette {
  zenith: [number, number, number];
  horizon: [number, number, number];
  sun: [number, number, number];
  ground: [number, number, number];
  star: number;
  exposure: number;
}

export const SKY_KEYFRAMES: SkyPalette[] = [
  // 0.00 — deep night
  {
    zenith: [0.016, 0.027, 0.086],
    horizon: [0.055, 0.075, 0.16],
    sun: [0.35, 0.42, 0.62],
    ground: [0.03, 0.045, 0.07],
    star: 1,
    exposure: 0.55,
  },
  // 0.25 — dawn
  {
    zenith: [0.24, 0.36, 0.62],
    horizon: [0.98, 0.68, 0.55],
    sun: [1.0, 0.72, 0.52],
    ground: [0.16, 0.14, 0.18],
    star: 0.12,
    exposure: 0.95,
  },
  // 0.50 — noon
  {
    zenith: [0.24, 0.47, 0.82],
    horizon: [0.68, 0.83, 0.96],
    sun: [1.0, 0.97, 0.9],
    ground: [0.2, 0.26, 0.2],
    star: 0,
    exposure: 1.15,
  },
  // 0.75 — dusk
  {
    zenith: [0.2, 0.22, 0.47],
    horizon: [0.97, 0.5, 0.4],
    sun: [1.0, 0.6, 0.42],
    ground: [0.14, 0.11, 0.15],
    star: 0.18,
    exposure: 0.9,
  },
  // 1.00 — night again (wraps to index 0)
  {
    zenith: [0.016, 0.027, 0.086],
    horizon: [0.055, 0.075, 0.16],
    sun: [0.35, 0.42, 0.62],
    ground: [0.03, 0.045, 0.07],
    star: 1,
    exposure: 0.55,
  },
];

function lerp3(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/** Smooth palette interpolation across the 5 keyframes. */
export function paletteAt(timeOfDay: number): SkyPalette {
  const t = clamp01(timeOfDay) * 4;
  const i = Math.min(3, Math.floor(t));
  const k = t - i;
  // Ease so dawn/dusk linger a little longer than a linear sweep.
  const e = k * k * (3 - 2 * k);
  const a = SKY_KEYFRAMES[i];
  const b = SKY_KEYFRAMES[i + 1];
  return {
    zenith: lerp3(a.zenith, b.zenith, e),
    horizon: lerp3(a.horizon, b.horizon, e),
    sun: lerp3(a.sun, b.sun, e),
    ground: lerp3(a.ground, b.ground, e),
    star: lerp(a.star, b.star, e),
    exposure: lerp(a.exposure, b.exposure, e),
  };
}

/**
 * Sun direction for a given time of day. The sun rises in the east (+x), arcs
 * slightly south (‑z) and sets in the west. `elevation` is normalised 0–1 where
 * 1 means directly overhead.
 */
export function sunDirection(timeOfDay: number, out: [number, number, number]): number {
  const angle = (timeOfDay - 0.25) * Math.PI * 2;
  const elevation = Math.sin(angle);
  const x = Math.cos(angle);
  const z = -0.32;
  const len = Math.hypot(x, elevation, z) || 1;
  out[0] = x / len;
  out[1] = elevation / len;
  out[2] = z / len;
  return clamp(elevation, -1, 1);
}
