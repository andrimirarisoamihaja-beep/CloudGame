"use client";

import { create } from "zustand";
import { clamp, clamp01 } from "@/lib/utils";
import type { WeatherSnapshot } from "@/lib/weather";
import type { WeatherName } from "@/lib/weather";
import {
  MAX_CLOUDS,
  MAX_BLOBS,
  CHALLENGES,
  boundingRadiusOf,
  cloudMass,
  createBlobs,
  createCloud,
  sanitizeClouds,
} from "@/lib/types";
import type { BlobData, ChallengeId, CloudData, ToolId } from "@/lib/types";

export type { BlobData, CloudData, ToolId, ChallengeId };
export { MAX_CLOUDS, MAX_BLOBS, CHALLENGES, boundingRadiusOf, cloudMass, createBlobs };

/**
 * The React-facing game state.
 *
 * Only *structural* facts live here: which clouds exist, which one is selected,
 * which tool is held, which challenges have unlocked. Everything that changes
 * continuously (wind, humidity, sun angle, blob drift) is animated inside
 * `lib/engine.ts` and mirrored back through `commitSimulation` about ten times a
 * second — enough for the HUD, far too slow to cause React churn.
 */

export interface Toast {
  id: string;
  title: string;
  subtitle?: string;
}

export interface SimulationSnapshot {
  timeOfDay: number;
  windDirection: [number, number, number];
  windStrength: number;
  humidity: number;
  isRaining: boolean;
  weather: WeatherName;
}

export interface GameState {
  clouds: CloudData[];
  selectedCloudId: string | null;
  tool: ToolId;

  timeOfDay: number;
  windDirection: [number, number, number];
  windStrength: number;
  humidity: number;
  isRaining: boolean;
  weather: WeatherName;

  audioEnabled: boolean;
  masterVolume: number;
  challenges: ChallengeId[];
  toast: Toast | null;
  isSaving: boolean;
  hoveringCloud: boolean;
  paused: boolean;
  ready: boolean;

  addCloud: (position: [number, number, number], density?: number) => string | null;
  updateCloud: (id: string, patch: Partial<Omit<CloudData, "id">>) => void;
  removeCloud: (id: string) => void;
  clearClouds: () => void;
  selectCloud: (id: string | null) => void;
  setTool: (tool: ToolId) => void;
  setHovering: (hovering: boolean) => void;
  advanceTime: (delta: number) => void;
  setTimeOfDay: (timeOfDay: number) => void;
  commitSimulation: (snapshot: SimulationSnapshot) => void;
  toggleAudio: () => void;
  setMasterVolume: (volume: number) => void;
  unlockChallenge: (id: ChallengeId) => void;
  pushToast: (toast: Omit<Toast, "id">) => void;
  dismissToast: (id?: string) => void;
  setSaving: (saving: boolean) => void;
  setPaused: (paused: boolean) => void;
  setReady: (ready: boolean) => void;
  loadSky: (payload: { clouds: unknown; timeOfDay: number; weather: WeatherSnapshot }) => void;
}

let toastCounter = 0;

export const useGameStore = create<GameState>()((set, get) => ({
  clouds: [],
  selectedCloudId: null,
  tool: "puff",

  timeOfDay: 0.3,
  windDirection: [1, 0, 0.15],
  windStrength: 0.25,
  humidity: 0.35,
  isRaining: false,
  weather: "CLEAR",

  audioEnabled: false,
  masterVolume: 0.65,
  challenges: [],
  toast: null,
  isSaving: false,
  hoveringCloud: false,
  paused: false,
  ready: false,

  addCloud: (position, density = 0.62) => {
    if (get().clouds.length >= MAX_CLOUDS) return null;
    const cloud = createCloud(position, density);
    set((state) => ({ clouds: [...state.clouds, cloud], selectedCloudId: cloud.id }));
    return cloud.id;
  },

  updateCloud: (id, patch) =>
    set((state) => ({
      clouds: state.clouds.map((cloud) =>
        cloud.id === id
          ? {
              ...cloud,
              ...patch,
              blobs: patch.blobs
                ? patch.blobs.slice(0, MAX_BLOBS).map((blob) => ({
                    position: [...blob.position] as [number, number, number],
                    radius: blob.radius,
                  }))
                : cloud.blobs,
            }
          : cloud,
      ),
    })),

  removeCloud: (id) =>
    set((state) => ({
      clouds: state.clouds.filter((cloud) => cloud.id !== id),
      selectedCloudId: state.selectedCloudId === id ? null : state.selectedCloudId,
    })),

  clearClouds: () => set({ clouds: [], selectedCloudId: null }),

  selectCloud: (id) => set({ selectedCloudId: id }),

  setTool: (tool) => set({ tool }),

  setHovering: (hovering) => set({ hoveringCloud: hovering }),

  advanceTime: (delta) => set((state) => ({ timeOfDay: (state.timeOfDay + delta + 1) % 1 })),

  setTimeOfDay: (timeOfDay) => set({ timeOfDay: clamp01(timeOfDay) }),

  commitSimulation: (snapshot) => set(snapshot),

  toggleAudio: () => set((state) => ({ audioEnabled: !state.audioEnabled })),

  setMasterVolume: (volume) => set({ masterVolume: clamp(volume, 0, 1) }),

  unlockChallenge: (id) => {
    const state = get();
    if (state.challenges.includes(id)) return;
    toastCounter += 1;
    const definition = CHALLENGES[id];
    set({
      challenges: [...state.challenges, id],
      toast: {
        id: `toast_${toastCounter}`,
        title: definition.title,
        subtitle: definition.subtitle,
      },
    });
  },

  pushToast: (toast) => {
    toastCounter += 1;
    set({ toast: { id: `toast_${toastCounter}`, ...toast } });
  },

  dismissToast: (id) => set((state) => (id && state.toast?.id !== id ? state : { toast: null })),

  setSaving: (saving) => set({ isSaving: saving }),

  setPaused: (paused) => set({ paused }),

  setReady: (ready) => set({ ready }),

  loadSky: ({ clouds, timeOfDay, weather }) =>
    set({
      clouds: sanitizeClouds(clouds),
      timeOfDay: clamp01(Number(timeOfDay) || 0),
      selectedCloudId: null,
      weather: weather.state,
      humidity: clamp01(weather.humidity),
      windStrength: clamp01(weather.windStrength),
      windDirection: [...weather.windDirection] as [number, number, number],
      isRaining: Boolean(weather.isRaining),
    }),
}));

export const CHALLENGE_DEFINITIONS = CHALLENGES;
