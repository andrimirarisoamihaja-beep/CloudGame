"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  Group,
  Mesh,
  ShaderMaterial,
  Vector3,
} from "three";
import {
  WEATHER_PROFILES,
  approachProfile,
  auroraVisible,
  cloudRains,
  nextWeatherState,
  paletteAt,
  rainbowVisible,
  randomTransitionDelay,
  sunDirection,
} from "@/lib/weather";
import {
  computeCloudCover,
  driftClouds,
  sim,
  strikeLightning,
  updateQuality,
  updateWind,
} from "@/lib/engine";
import { useGameStore } from "@/lib/store";
import { audio } from "@/lib/audio";
import { auroraFragmentShader, auroraVertexShader } from "@/shaders/aurora.glsl";
import { rainbowFragmentShader, rainbowVertexShader } from "@/shaders/rainbow.glsl";
import { clamp, clamp01, damp } from "@/lib/utils";

/** A full day/night cycle takes five real minutes. */
const DAY_LENGTH_SECONDS = 300;
/** Houses the valley starts with (kept in sync with `Landscape`). */
const BASE_HOUSES = 5;
const SUN_DIR: [number, number, number] = [0, 1, 0];

/** Scratch objects: the driver must not allocate inside the frame loop. */
const scratchHorizon = new Color();
const scratchZenith = new Color();

/**
 * The single heartbeat of the simulation.
 *
 * One `useFrame` advances time, the weather state machine, wind, humidity,
 * rainfall, lightning, the rainbow, the aurora and the landscape's growth, then
 * mirrors a small snapshot into the store for the HUD (about ten times a
 * second). Nothing here triggers a React render unless something structural
 * actually changed.
 */
function Simulation() {
  const commitAccumulator = useRef(0);
  const audioAccumulator = useRef(0);
  const lightningAccumulator = useRef(0);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1);
    const store = useGameStore.getState();

    sim.time += dt;
    updateQuality(delta);

    // --- day / night -------------------------------------------------------
    if (!store.paused) {
      sim.timeOfDay = (sim.timeOfDay + dt / DAY_LENGTH_SECONDS) % 1;
    }
    sim.minutes = Math.round(sim.timeOfDay * 1440);
    sim.sunElevation = sunDirection(sim.timeOfDay, SUN_DIR);
    sim.sunDir.set(SUN_DIR[0], SUN_DIR[1], SUN_DIR[2]).normalize();
    sim.moonDir.copy(sim.sunDir).negate();
    // Once the sun is down, the moon becomes the key light on the clouds, so
    // night clouds get a rim instead of a flat silhouette.
    sim.cloudSunDir.copy(sim.sunElevation > 0.03 ? sim.sunDir : sim.moonDir);

    const palette = paletteAt(sim.timeOfDay);
    sim.paletteExposure = palette.exposure;
    sim.lightColor.setRGB(palette.sun[0], palette.sun[1], palette.sun[2]);
    sim.sunColor.setRGB(palette.sun[0], palette.sun[1], palette.sun[2]);
    scratchHorizon.setRGB(palette.horizon[0], palette.horizon[1], palette.horizon[2]);
    scratchZenith.setRGB(palette.zenith[0], palette.zenith[1], palette.zenith[2]);
    sim.ambientColor.copy(scratchHorizon).lerp(scratchZenith, 0.45);
    sim.shadowColor.copy(scratchZenith).multiplyScalar(0.75).lerp(scratchHorizon, 0.25);
    sim.groundColor.setRGB(palette.ground[0], palette.ground[1], palette.ground[2]);

    const daylight = clamp01((sim.sunElevation + 0.12) / 0.35);
    sim.sunIntensity = 0.25 + daylight * 1.25 * (1 - sim.overcast * 0.55);
    sim.ambientIntensity = 0.35 + daylight * 0.5;

    // --- weather state machine --------------------------------------------
    sim.stateAge += dt;
    if (sim.stateAge > sim.stateDuration) {
      sim.weather = sim.nextWeather;
      sim.nextWeather = nextWeatherState(sim.weather);
      sim.stateAge = 0;
      sim.stateDuration = randomTransitionDelay();
      if (sim.weather === "STORM") store.unlockChallenge("storm");
    }
    approachProfile(sim.profile, WEATHER_PROFILES[sim.weather], dt, 0.3);

    // --- wind --------------------------------------------------------------
    updateWind(sim.time);
    driftClouds(dt);
    sim.humidity = clamp01(sim.profile.humidity);

    // --- rain --------------------------------------------------------------
    const raining: string[] = [];
    let rainWeight = 0;
    for (const runtime of sim.clouds.values()) {
      const shouldRain = cloudRains(sim.humidity, runtime.density);
      runtime.rain = damp(runtime.rain, shouldRain ? 1 : 0, 1.2, dt);
      if (runtime.rain > 0.25) {
        raining.push(runtime.id);
        rainWeight += runtime.rain;
      }
    }
    sim.rainingCloudIds = raining;

    const targetRain = sim.profile.rain * clamp01(rainWeight / 1.5);
    sim.rainIntensity = damp(sim.rainIntensity, targetRain, 0.9, dt);
    const wasRaining = sim.isRaining;
    sim.isRaining = sim.rainIntensity > 0.03;
    if (sim.isRaining) {
      sim.secondsSinceRain = 0;
      sim.rainTotal += sim.rainIntensity * dt;
      if (!wasRaining) store.unlockChallenge("first-rain");
    } else {
      sim.secondsSinceRain += dt;
    }

    // --- lightning ---------------------------------------------------------
    lightningAccumulator.current += dt;
    if (sim.profile.lightning > 0.001 && lightningAccumulator.current > 0.25) {
      const chance = sim.profile.lightning * lightningAccumulator.current * (0.4 + sim.rainIntensity);
      if (Math.random() < chance) {
        strikeLightning(0.9 + Math.random() * 0.45);
        audio.playThunder(clamp01(sim.rainIntensity + 0.35));
      }
      lightningAccumulator.current = 0;
    }
    // Flash decays over roughly 0.3s.
    sim.flash = Math.max(0, sim.flash - dt * 3.2);

    // --- sky extras --------------------------------------------------------
    sim.cloudCover = computeCloudCover();
    sim.overcast = clamp01(sim.profile.overcast * 0.78 + sim.cloudCover * 0.45);
    sim.nightLights = damp(sim.nightLights, 1 - daylight, 1.5, dt);

    const rainbowTarget = rainbowVisible(sim.secondsSinceRain, sim.sunElevation) ? 1 : 0;
    const previousRainbow = sim.rainbow;
    sim.rainbow = damp(sim.rainbow, rainbowTarget, rainbowTarget > previousRainbow ? 1.1 : 0.55, dt);
    if (sim.rainbow > 0.55 && previousRainbow <= 0.55) store.unlockChallenge("rainbow");

    sim.aurora = damp(
      sim.aurora,
      auroraVisible(sim.timeOfDay, sim.humidity) ? 1 : 0,
      0.5,
      dt,
    );

    // --- landscape growth --------------------------------------------------
    sim.growth = clamp01(sim.rainTotal / 150);
    const houses = BASE_HOUSES + Math.floor(sim.growth * 5);
    if (houses > sim.housesBuilt) {
      // The five the valley starts with are not an achievement.
      if (sim.housesBuilt >= BASE_HOUSES) store.unlockChallenge("village-growth");
      sim.housesBuilt = houses;
    }
    sim.treesGrown = Math.floor(sim.growth * 16);

    if (sim.nightLights > 0.6 && sim.clouds.size > 5) store.unlockChallenge("night-sky");

    // --- adaptive resolution ----------------------------------------------
    if (Math.abs(state.viewport.dpr - sim.dpr) > 0.01) {
      state.setDpr(sim.dpr);
    }

    // --- audio (≈8 Hz, not every frame) ------------------------------------
    audioAccumulator.current += dt;
    if (audioAccumulator.current > 0.12) {
      audioAccumulator.current = 0;
      const clouds = [];
      for (const runtime of sim.clouds.values()) {
        clouds.push({
          id: runtime.id,
          roundness: runtime.roundness,
          mass: runtime.mass,
          pan: clamp(runtime.position[0] / 70, -1, 1),
          density: runtime.density,
        });
      }
      audio.update({
        wind: sim.windStrength,
        rain: sim.rainIntensity,
        night: 1 - daylight,
        mood: sim.profile.mood,
        overcast: sim.overcast,
        clouds,
      });
    }

    // --- store mirror (≈10 Hz) ---------------------------------------------
    commitAccumulator.current += dt;
    if (commitAccumulator.current > 0.1) {
      commitAccumulator.current = 0;
      store.commitSimulation({
        timeOfDay: sim.timeOfDay,
        windDirection: [sim.wind.x, sim.wind.y, sim.wind.z],
        windStrength: sim.windStrength,
        humidity: sim.humidity,
        isRaining: sim.isRaining,
        weather: sim.weather,
      });
    }
  });

  return null;
}

/** Aurora curtain, far behind the hills, only on cold dry nights. */
function Aurora() {
  const materialRef = useRef<ShaderMaterial>(null);
  const meshRef = useRef<Mesh>(null);

  const uniforms = useMemo(
    () => ({
      u_time: { value: 0 },
      u_intensity: { value: 0 },
      u_colorLow: { value: new Vector3(0.28, 0.95, 0.6) },
      u_colorHigh: { value: new Vector3(0.62, 0.42, 0.95) },
    }),
    [],
  );

  useFrame(() => {
    const mesh = meshRef.current;
    const material = materialRef.current;
    if (!mesh || !material) return;
    material.uniforms.u_time.value = sim.time;
    material.uniforms.u_intensity.value = sim.aurora;
    mesh.visible = sim.aurora > 0.01;
  });

  return (
    <mesh ref={meshRef} position={[0, 88, -235]} renderOrder={-500}>
      <planeGeometry args={[520, 170, 1, 1]} />
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        vertexShader={auroraVertexShader}
        fragmentShader={auroraFragmentShader}
        transparent
        depthWrite={false}
        side={DoubleSide}
        blending={AdditiveBlending}
      />
    </mesh>
  );
}

/** Rainbow: an arc opposite the sun, fading in after the rain lets up. */
function Rainbow() {
  const groupRef = useRef<Group>(null);
  const materialRef = useRef<ShaderMaterial>(null);

  const uniforms = useMemo(
    () => ({
      u_opacity: { value: 0 },
      u_time: { value: 0 },
    }),
    [],
  );

  useFrame((state) => {
    const group = groupRef.current;
    const material = materialRef.current;
    if (!group || !material) return;

    material.uniforms.u_opacity.value = sim.rainbow * 0.42;
    material.uniforms.u_time.value = sim.time;
    group.visible = sim.rainbow > 0.02;
    if (!group.visible) return;

    // Sit the arch toward the antisolar azimuth, nudged so it stays on screen.
    const antiX = -sim.sunDir.x;
    const antiZ = -sim.sunDir.z;
    const length = Math.hypot(antiX, antiZ) || 1;
    const offset = clamp((antiX / length) * 150, -95, 95);
    group.position.set(offset, 4, -145);
    group.rotation.y = Math.atan2(state.camera.position.x - offset, state.camera.position.z + 145);
  });

  return (
    <group ref={groupRef}>
      <mesh renderOrder={-400}>
        <torusGeometry args={[120, 4.6, 6, 128, Math.PI]} />
        <shaderMaterial
          ref={materialRef}
          uniforms={uniforms}
          vertexShader={rainbowVertexShader}
          fragmentShader={rainbowFragmentShader}
          transparent
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

/**
 * A few clouds so the sky is never empty on the very first frame — the game
 * should be beautiful before the player has done anything at all.
 */
function OpeningSky() {
  useEffect(() => {
    const store = useGameStore.getState();
    if (store.clouds.length > 0) return;
    const seeds: Array<[number, number, number]> = [
      [-34, 34, -12],
      [12, 41, -26],
      [46, 29, 4],
      [-8, 52, -40],
    ];
    seeds.forEach((position, index) => {
      store.addCloud(position, index % 2 === 0 ? 0.66 : 0.48);
    });
  }, []);
  return null;
}

export default function WeatherSystem() {
  return (
    <>
      <Simulation />
      <OpeningSky />
      <Aurora />
      <Rainbow />
    </>
  );
}
