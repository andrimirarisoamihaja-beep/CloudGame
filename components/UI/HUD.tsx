"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowUp,
  Cloud,
  CloudRain,
  Cloudy,
  Image as ImageIcon,
  Moon,
  Sun,
  Sunrise,
  Sunset,
  Volume2,
  VolumeX,
  Wind,
  Zap,
} from "lucide-react";
import { useGameStore } from "@/lib/store";
import { audio } from "@/lib/audio";
import { describeWeather, type WeatherName } from "@/lib/weather";
import SaveButton from "./SaveButton";

const WEATHER_ICONS: Record<WeatherName, typeof Cloud> = {
  CLEAR: Sun,
  CLOUDY: Cloud,
  OVERCAST: Cloudy,
  RAIN: CloudRain,
  STORM: Zap,
};

/** Which hour of the day the sky is in, as an icon. */
function timeIcon(timeOfDay: number) {
  if (timeOfDay < 0.21 || timeOfDay >= 0.82) return Moon;
  if (timeOfDay < 0.29) return Sunrise;
  if (timeOfDay < 0.68) return Sun;
  return Sunset;
}

function timeLabel(timeOfDay: number): string {
  const minutes = Math.round(timeOfDay * 1440);
  const hours = Math.floor(minutes / 60) % 24;
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}`;
}

export default function HUD() {
  const timeOfDay = useGameStore((state) => state.timeOfDay);
  const windDirection = useGameStore((state) => state.windDirection);
  const windStrength = useGameStore((state) => state.windStrength);
  const weather = useGameStore((state) => state.weather);
  const isRaining = useGameStore((state) => state.isRaining);
  const audioEnabled = useGameStore((state) => state.audioEnabled);
  const masterVolume = useGameStore((state) => state.masterVolume);
  const toggleAudio = useGameStore((state) => state.toggleAudio);
  const setMasterVolume = useGameStore((state) => state.setMasterVolume);

  const [titleVisible, setTitleVisible] = useState(true);
  const volumeRef = useRef<HTMLDivElement>(null);

  // The title greets the player, then gets out of the way.
  useEffect(() => {
    const timer = window.setTimeout(() => setTitleVisible(false), 7000);
    return () => window.clearTimeout(timer);
  }, []);

  // The wind arrow points where the air is going: +x is screen-right, -z is
  // "into the sky", which reads as up on a compass.
  const windAngle = (Math.atan2(windDirection[0], -windDirection[2]) * 180) / Math.PI;
  const TimeIcon = timeIcon(timeOfDay);
  const WeatherIcon = WEATHER_ICONS[weather];

  return (
    <>
      {/* ------------------------------------------------ top left: wind */}
      <div className="pointer-events-none absolute left-5 top-5 flex items-center gap-3">
        <div
          className="glass flex items-center gap-2 rounded-2xl px-3 py-2"
          title={`Wind ${Math.round(windStrength * 100)}%`}
        >
          <Wind size={16} strokeWidth={1.7} className="text-white/70" />
          <span className="relative flex h-5 w-5 items-center justify-center">
            <ArrowUp
              size={16}
              strokeWidth={2}
              className="text-white/80 transition-transform duration-500"
              style={{
                transform: `rotate(${windAngle}deg)`,
                opacity: 0.35 + windStrength * 0.65,
              }}
            />
          </span>
        </div>
      </div>

      {/* --------------------------------------------- top centre: title */}
      <div
        className={[
          "pointer-events-none absolute left-1/2 top-6 -translate-x-1/2 transition-opacity duration-[2000ms]",
          titleVisible ? "opacity-100" : "opacity-0",
        ].join(" ")}
      >
        <p className="font-serif text-[19px] tracking-[0.32em] text-white/70">CLOUD SCULPTOR</p>
      </div>

      {/* ----------------------------------------------- top right: time */}
      <div className="pointer-events-none absolute right-5 top-5 flex items-center gap-3">
        <div
          className="glass flex items-center gap-2 rounded-2xl px-3 py-2"
          title={`${timeLabel(timeOfDay)} · ${describeWeather(weather)}${isRaining ? " · raining" : ""}`}
        >
          <TimeIcon size={16} strokeWidth={1.7} className="text-white/75" />
          <WeatherIcon size={15} strokeWidth={1.7} className="text-white/50" />
        </div>
      </div>

      {/* ------------------------------------------- bottom right: tools */}
      <div className="pointer-events-none absolute bottom-5 right-5 flex items-end gap-2">
        <SaveButton />

        <Link
          href="/gallery"
          title="Gallery of saved skies"
          aria-label="Gallery of saved skies"
          className="glass pointer-events-auto flex h-11 w-11 items-center justify-center rounded-2xl text-white/75 transition-all duration-200 hover:bg-white/25 hover:text-white"
        >
          <ImageIcon size={19} strokeWidth={1.7} />
        </Link>

        <div ref={volumeRef} className="group pointer-events-auto relative">
          <button
            type="button"
            onClick={() => {
              // Tone's AudioContext must be created inside a user gesture.
              audio.setEnabled(!audioEnabled);
              toggleAudio();
            }}
            title={audioEnabled ? "Mute the sky" : "Listen to the sky"}
            aria-label={audioEnabled ? "Mute the sky" : "Listen to the sky"}
            className="glass flex h-11 w-11 items-center justify-center rounded-2xl text-white/75 transition-all duration-200 hover:bg-white/25 hover:text-white"
          >
            {audioEnabled ? (
              <Volume2 size={19} strokeWidth={1.7} />
            ) : (
              <VolumeX size={19} strokeWidth={1.7} />
            )}
          </button>

          <div
            className={[
              "glass absolute bottom-14 right-0 origin-bottom-right rounded-2xl px-3 py-2 transition-all duration-200",
              audioEnabled
                ? "pointer-events-auto opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                : "pointer-events-none opacity-0",
            ].join(" ")}
          >
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(masterVolume * 100)}
              onChange={(event) => {
                const value = Number(event.target.value) / 100;
                audio.setVolume(value);
                setMasterVolume(value);
              }}
              aria-label="Volume"
              title="Volume"
              className="h-1 w-28 cursor-pointer appearance-none rounded-full bg-white/30 accent-white"
            />
          </div>
        </div>
      </div>
    </>
  );
}
