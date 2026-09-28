"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  AdditiveBlending,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  MeshBasicMaterial,
} from "three";
import { sim } from "@/lib/engine";

const SUN_DISTANCE = 320;
const MOON_DISTANCE = 300;

/**
 * Sun, moon and the lights that follow them.
 *
 * The sun is a directional light plus two spheres (a hard disc and a soft
 * additive halo). Everything is positioned from the shared `sim.sunDir` vector,
 * so the sky shader's sun disc, the cloud lighting and the landscape lighting
 * always agree on where the light is coming from.
 */
export default function Sun() {
  const sunRef = useRef<DirectionalLight>(null);
  const moonLightRef = useRef<DirectionalLight>(null);
  const hemiRef = useRef<HemisphereLight>(null);
  const sunGroup = useRef<Group>(null);
  const moonGroup = useRef<Group>(null);
  const sunDisc = useRef<MeshBasicMaterial>(null);
  const sunHalo = useRef<MeshBasicMaterial>(null);
  const moonDisc = useRef<MeshBasicMaterial>(null);

  const color = useMemo(() => new Color(), []);

  useFrame(() => {
    const sun = sim.sunDir;
    const elevation = sim.sunElevation;

    // Directional sun: bright and warm when high, red and weak when low.
    if (sunRef.current) {
      sunRef.current.position.set(sun.x * 120, sun.y * 120, sun.z * 120);
      const daylight = Math.max(0, Math.min(1, (elevation + 0.08) / 0.35));
      sunRef.current.intensity = 0.15 + daylight * 1.85 * (1 - sim.overcast * 0.62);
      sunRef.current.color.copy(sim.lightColor);
    }

    // Moonlight: the same arc, twelve hours later, in cool blue.
    if (moonLightRef.current) {
      const moon = sim.moonDir;
      moonLightRef.current.position.set(moon.x * 120, moon.y * 120, moon.z * 120);
      const moonlight = Math.max(0, Math.min(1, (moon.y + 0.1) / 0.3));
      moonLightRef.current.intensity = 0.06 + moonlight * 0.42 * (1 - sim.overcast * 0.7);
    }

    if (hemiRef.current) {
      const night = 1 - Math.max(0, Math.min(1, (elevation + 0.12) / 0.3));
      color.copy(sim.ambientColor).lerp(sim.shadowColor, night * 0.5);
      hemiRef.current.color.copy(color);
      hemiRef.current.groundColor.copy(sim.groundColor);
      hemiRef.current.intensity = 0.35 + (1 - night) * 0.55 + sim.overcast * 0.1;
    }

    if (sunGroup.current) {
      sunGroup.current.position.set(sun.x * SUN_DISTANCE, sun.y * SUN_DISTANCE, sun.z * SUN_DISTANCE);
      const visible = Math.max(0, Math.min(1, (elevation + 0.14) / 0.16));
      sunGroup.current.visible = visible > 0.01;
      sunGroup.current.scale.setScalar(0.6 + visible * 0.4);
      if (sunDisc.current) {
        sunDisc.current.color.copy(sim.sunColor);
        sunDisc.current.opacity = visible;
      }
      if (sunHalo.current) {
        sunHalo.current.color.copy(sim.sunColor);
        sunHalo.current.opacity = visible * 0.32 * (1 - sim.overcast * 0.8);
      }
    }

    if (moonGroup.current) {
      const moon = sim.moonDir;
      moonGroup.current.position.set(
        moon.x * MOON_DISTANCE,
        moon.y * MOON_DISTANCE,
        moon.z * MOON_DISTANCE,
      );
      const visible = Math.max(0, Math.min(1, (moon.y + 0.08) / 0.18));
      moonGroup.current.visible = visible > 0.01;
      if (moonDisc.current) moonDisc.current.opacity = visible * (1 - sim.overcast * 0.85);
    }
  });

  return (
    <>
      <hemisphereLight ref={hemiRef} args={["#cfe3ff", "#4b5a3f", 0.7]} />
      <directionalLight ref={sunRef} intensity={1.2} position={[60, 90, -40]} />
      <directionalLight ref={moonLightRef} intensity={0.15} color="#9fb6ff" position={[-60, 60, 40]} />

      <group ref={sunGroup}>
        <mesh renderOrder={-900}>
          <sphereGeometry args={[7.5, 20, 16]} />
          <meshBasicMaterial ref={sunDisc} transparent depthWrite={false} />
        </mesh>
        <mesh scale={3.4} renderOrder={-900}>
          <sphereGeometry args={[7.5, 20, 16]} />
          <meshBasicMaterial
            ref={sunHalo}
            transparent
            depthWrite={false}
            blending={AdditiveBlending}
            opacity={0.25}
          />
        </mesh>
      </group>

      <group ref={moonGroup}>
        <mesh renderOrder={-900}>
          <sphereGeometry args={[6, 20, 16]} />
          <meshBasicMaterial ref={moonDisc} color="#eef2ff" transparent depthWrite={false} />
        </mesh>
        <mesh scale={2.6} renderOrder={-900}>
          <sphereGeometry args={[6, 20, 16]} />
          <meshBasicMaterial
            color="#b9c8ff"
            transparent
            depthWrite={false}
            blending={AdditiveBlending}
            opacity={0.14}
          />
        </mesh>
      </group>
    </>
  );
}
