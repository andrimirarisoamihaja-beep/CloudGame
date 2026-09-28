"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";
import HUD from "@/components/UI/HUD";
import Toolbar from "@/components/UI/Toolbar";
import ChallengeToast from "@/components/UI/ChallengeToast";
import { useGameStore } from "@/lib/store";
import { sim } from "@/lib/engine";
import { SKY_HANDOFF_KEY, type SkyHandoff } from "@/lib/handoff";
import { clamp01 } from "@/lib/utils";
import { isWeatherName, nextWeatherState } from "@/lib/weather";

/**
 * The canvas is the only client-only, WebGL-dependent chunk; everything around
 * it renders immediately. Until it arrives the page shows a painted sky, so the
 * game is never a blank screen, and there is no loading spinner anywhere.
 */
const GameCanvas = dynamic(() => import("@/components/GameCanvas"), {
  ssr: false,
  loading: () => <div className="sky-fallback" aria-hidden />,
});

export default function GamePage() {
  const loadSky = useGameStore((state) => state.loadSky);

  // A sky chosen in the gallery arrives through sessionStorage.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.sessionStorage.getItem(SKY_HANDOFF_KEY);
    if (!raw) return;
    window.sessionStorage.removeItem(SKY_HANDOFF_KEY);
    try {
      const parsed = JSON.parse(raw) as SkyHandoff;
      if (!parsed || !Array.isArray(parsed.clouds)) return;
      loadSky({
        clouds: parsed.clouds,
        timeOfDay: parsed.timeOfDay ?? 0.3,
        weather: parsed.weather,
      });
      sim.timeOfDay = parsed.timeOfDay ?? sim.timeOfDay;
      // Restore the weather too, so a rainy sky keeps raining when you open it.
      if (parsed.weather && isWeatherName(parsed.weather.state)) {
        sim.weather = parsed.weather.state;
        sim.nextWeather = nextWeatherState(sim.weather);
        sim.humidity = clamp01(parsed.weather.humidity);
      }
      useGameStore.getState().pushToast({
        title: "Sky restored",
        subtitle: "The gallery sky is yours to keep sculpting",
      });
    } catch {
      // A malformed handoff is simply ignored — the sky opens as usual.
    }
  }, [loadSky]);

  return (
    <main className="relative h-screen w-screen overflow-hidden">
      <GameCanvas />

      {/* The overlay is excluded from screenshots: a saved sky is only sky. */}
      <div className="pointer-events-none absolute inset-0 select-none" data-no-capture="true">
        <HUD />

        <div className="absolute bottom-5 left-1/2 -translate-x-1/2">
          <Toolbar />
        </div>

        <div className="absolute left-1/2 top-16 -translate-x-1/2">
          <ChallengeToast />
        </div>
      </div>
    </main>
  );
}
