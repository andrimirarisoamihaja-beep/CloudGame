import type { CloudData } from "@/lib/types";
import type { WeatherSnapshot } from "@/lib/weather";

/** How the gallery hands a saved sky back to the game (no URL length limits). */
export const SKY_HANDOFF_KEY = "cloud-sculptor:load";

export interface SkyHandoff {
  clouds: CloudData[];
  timeOfDay: number;
  weather: WeatherSnapshot;
}

export function storeHandoff(handoff: SkyHandoff): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(SKY_HANDOFF_KEY, JSON.stringify(handoff));
  } catch {
    // Storage full or blocked: loading simply won't be offered.
  }
}
