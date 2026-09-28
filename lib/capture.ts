"use client";

import type { WebGLRenderer } from "three";
import type { WeatherName, WeatherSnapshot } from "@/lib/weather";
import { sim, snapshotClouds } from "@/lib/engine";
import type { CloudData } from "@/lib/types";

/**
 * Screenshotting a WebGL scene.
 *
 * `html2canvas` walks the DOM and re-draws it, which is perfect for the HUD but
 * depends on the WebGL canvas keeping its drawing buffer around. Two safeguards:
 * the renderer is created with `preserveDrawingBuffer: true`, and if the cloned
 * canvas still comes back empty we fall back to reading the live GL canvas
 * directly, so a saved sky is never a blank rectangle.
 */

let rendererRef: WebGLRenderer | null = null;

export function registerRenderer(instance: WebGLRenderer | null): void {
  rendererRef = instance;
}

/** Longest edge of a saved screenshot — keeps data URLs small enough for Postgres. */
const MAX_WIDTH = 1180;
const JPEG_QUALITY = 0.82;

function toJpeg(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}

function isBlank(canvas: HTMLCanvasElement): boolean {
  const probe = document.createElement("canvas");
  probe.width = 24;
  probe.height = 14;
  const context = probe.getContext("2d");
  if (!context) return false;
  context.drawImage(canvas, 0, 0, probe.width, probe.height);
  const { data } = context.getImageData(0, 0, probe.width, probe.height);
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 8) return false;
  }
  return true;
}

function fromRenderer(): string | null {
  const renderer = rendererRef;
  if (!renderer) return null;
  try {
    return renderer.domElement.toDataURL("image/jpeg", JPEG_QUALITY);
  } catch {
    return null;
  }
}

export async function captureSky(): Promise<string | null> {
  const element = document.getElementById("game-root");
  if (!element) return fromRenderer();

  const width = element.clientWidth || window.innerWidth;
  const scale = Math.min(1, MAX_WIDTH / Math.max(1, width));

  try {
    const { default: html2canvas } = await import("html2canvas");
    const canvas = await html2canvas(element, {
      backgroundColor: null,
      scale,
      logging: false,
      useCORS: true,
      ignoreElements: (node) => node.getAttribute?.("data-no-capture") === "true",
    });
    if (!isBlank(canvas)) return toJpeg(canvas);
  } catch {
    // Fall through to the direct GL read below.
  }
  return fromRenderer();
}

/** A small, evocative default name so saving never asks the player to type. */
export function suggestSkyName(timeOfDay: number, weather: WeatherName): string {
  const byWeather: Partial<Record<WeatherName, string>> = {
    STORM: "Storm Light",
    RAIN: "Soft Rain",
    OVERCAST: "Grey Quiet",
  };
  if (byWeather[weather]) return byWeather[weather] as string;

  if (timeOfDay < 0.2 || timeOfDay > 0.85) return "Night Drift";
  if (timeOfDay < 0.3) return "First Light";
  if (timeOfDay < 0.45) return "Morning Wide";
  if (timeOfDay < 0.62) return "High Blue";
  if (timeOfDay < 0.75) return "Long Afternoon";
  return "Last Light";
}

export interface SkyPayload {
  name: string;
  screenshotUrl: string | null;
  cloudState: CloudData[];
  weatherState: WeatherSnapshot;
  timeOfDay: number;
}

/** Everything needed to restore this exact moment in the sky. */
export function buildSkyPayload(screenshotUrl: string | null): SkyPayload {
  return {
    name: suggestSkyName(sim.timeOfDay, sim.weather),
    screenshotUrl,
    cloudState: snapshotClouds(),
    weatherState: {
      state: sim.weather,
      humidity: Number(sim.humidity.toFixed(3)),
      windStrength: Number(sim.windStrength.toFixed(3)),
      windDirection: [
        Number(sim.wind.x.toFixed(3)),
        Number(sim.wind.y.toFixed(3)),
        Number(sim.wind.z.toFixed(3)),
      ],
      rainIntensity: Number(sim.rainIntensity.toFixed(3)),
      overcast: Number(sim.overcast.toFixed(3)),
      isRaining: sim.isRaining,
    },
    timeOfDay: Math.round(sim.timeOfDay * 1440),
  };
}
