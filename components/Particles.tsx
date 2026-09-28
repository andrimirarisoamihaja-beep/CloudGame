"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { DoubleSide, InstancedMesh, Object3D } from "three";
import { sim, pushRainHit } from "@/lib/engine";
import { LAKE_SURFACE, terrainHeight } from "@/lib/terrain";

/**
 * Everything that falls, floats or drifts: rain, leaves and dandelion seeds.
 *
 * All three are `InstancedMesh`es updated in a single `useFrame` — no per-frame
 * React, no per-particle objects. Rain drops report where they land so the
 * flower patches downstream know where the ground got wet.
 */

const RAIN_COUNT = 720;
const LEAF_COUNT = 46;
const SEED_COUNT = 34;

const dummy = new Object3D();

interface RainDrop {
  x: number;
  y: number;
  z: number;
  speed: number;
  alive: boolean;
}

interface Leaf {
  x: number;
  y: number;
  z: number;
  spin: number;
  phase: number;
  speed: number;
  alive: boolean;
}

interface Seed {
  x: number;
  y: number;
  z: number;
  phase: number;
  speed: number;
  alive: boolean;
}

function pickRainingCloud(): { x: number; y: number; z: number; radius: number } | null {
  if (sim.rainingCloudIds.length === 0) return null;
  const id = sim.rainingCloudIds[Math.floor(Math.random() * sim.rainingCloudIds.length)];
  const runtime = sim.clouds.get(id);
  if (!runtime) return null;
  return {
    x: runtime.position[0],
    y: runtime.position[1],
    z: runtime.position[2],
    radius: runtime.boundingRadius,
  };
}

export default function Particles() {
  const rainRef = useRef<InstancedMesh>(null);
  const leafRef = useRef<InstancedMesh>(null);
  const seedRef = useRef<InstancedMesh>(null);

  const rain = useMemo<RainDrop[]>(
    () =>
      Array.from({ length: RAIN_COUNT }, () => ({ x: 0, y: -500, z: 0, speed: 30, alive: false })),
    [],
  );
  const leaves = useMemo<Leaf[]>(
    () =>
      Array.from({ length: LEAF_COUNT }, () => ({
        x: 0,
        y: -500,
        z: 0,
        spin: 1,
        phase: Math.random() * 6.28,
        speed: 1,
        alive: false,
      })),
    [],
  );
  const seeds = useMemo<Seed[]>(
    () =>
      Array.from({ length: SEED_COUNT }, () => ({
        x: 0,
        y: -500,
        z: 0,
        phase: Math.random() * 6.28,
        speed: 1,
        alive: false,
      })),
    [],
  );

  const spawnTimer = useRef(0);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);

    // ---------------------------------------------------------------- rain
    const rainMesh = rainRef.current;
    if (rainMesh) {
      const active = Math.round(RAIN_COUNT * sim.rainIntensity);
      for (let i = 0; i < RAIN_COUNT; i += 1) {
        const drop = rain[i];
        if (i >= active) {
          if (drop.alive) {
            drop.alive = false;
            dummy.position.set(0, -900, 0);
            dummy.scale.setScalar(0);
            dummy.updateMatrix();
            rainMesh.setMatrixAt(i, dummy.matrix);
          }
          continue;
        }
        if (!drop.alive) {
          const cloud = pickRainingCloud();
          if (!cloud) break;
          const angle = Math.random() * Math.PI * 2;
          const spread = Math.sqrt(Math.random()) * cloud.radius * 0.62;
          drop.x = cloud.x + Math.cos(angle) * spread;
          drop.z = cloud.z + Math.sin(angle) * spread;
          drop.y = cloud.y - cloud.radius * 0.25;
          drop.speed = 26 + Math.random() * 16;
          drop.alive = true;
        }

        drop.y -= drop.speed * dt;
        drop.x += sim.wind.x * sim.windStrength * 9 * dt;
        drop.z += sim.wind.z * sim.windStrength * 9 * dt;

        const ground = terrainHeight(drop.x, drop.z);
        const surface = Math.max(ground, LAKE_SURFACE);
        if (drop.y <= surface) {
          pushRainHit(drop.x, drop.z);
          drop.alive = false;
          dummy.position.set(0, -900, 0);
          dummy.scale.setScalar(0);
          dummy.updateMatrix();
          rainMesh.setMatrixAt(i, dummy.matrix);
          continue;
        }

        dummy.position.set(drop.x, drop.y, drop.z);
        dummy.rotation.set(0, 0, Math.atan2(sim.wind.x * sim.windStrength, drop.speed) * 0.6);
        dummy.scale.set(1, 1 + drop.speed * 0.03, 1);
        dummy.updateMatrix();
        rainMesh.setMatrixAt(i, dummy.matrix);
      }
      rainMesh.instanceMatrix.needsUpdate = true;
      rainMesh.visible = sim.rainIntensity > 0.01;
    }

    // --------------------------------------------------------------- leaves
    const leafMesh = leafRef.current;
    if (leafMesh) {
      spawnTimer.current += dt;
      const wantLeaves = sim.windStrength > 0.28 && sim.rainIntensity < 0.15;
      const active = wantLeaves ? Math.round(LEAF_COUNT * Math.min(1, sim.windStrength * 1.6)) : 0;
      for (let i = 0; i < LEAF_COUNT; i += 1) {
        const leaf = leaves[i];
        if (i >= active) {
          if (leaf.alive) {
            leaf.alive = false;
            dummy.position.set(0, -900, 0);
            dummy.scale.setScalar(0);
            dummy.updateMatrix();
            leafMesh.setMatrixAt(i, dummy.matrix);
          }
          continue;
        }
        if (!leaf.alive) {
          leaf.x = (Math.random() - 0.5) * 150;
          leaf.z = (Math.random() - 0.5) * 90;
          leaf.y = terrainHeight(leaf.x, leaf.z) + 8 + Math.random() * 26;
          leaf.speed = 2 + Math.random() * 3;
          leaf.spin = (Math.random() - 0.5) * 3;
          leaf.alive = true;
        }

        leaf.phase += dt * leaf.spin;
        leaf.x += (sim.wind.x * sim.windStrength * 14 + Math.sin(leaf.phase) * 1.4) * dt;
        leaf.z += (sim.wind.z * sim.windStrength * 14 + Math.cos(leaf.phase * 0.8) * 1.1) * dt;
        leaf.y += (Math.sin(leaf.phase * 1.7) * 1.6 - 1.1) * dt;

        if (leaf.y < terrainHeight(leaf.x, leaf.z) + 0.4 || Math.abs(leaf.x) > 130) {
          leaf.alive = false;
        }

        dummy.position.set(leaf.x, leaf.y, leaf.z);
        dummy.rotation.set(leaf.phase * 0.7, leaf.phase, leaf.phase * 0.4);
        dummy.scale.setScalar(0.55 + (i % 5) * 0.06);
        dummy.updateMatrix();
        leafMesh.setMatrixAt(i, dummy.matrix);
      }
      leafMesh.instanceMatrix.needsUpdate = true;
      leafMesh.visible = active > 0;
    }

    // ---------------------------------------------------------------- seeds
    const seedMesh = seedRef.current;
    if (seedMesh) {
      const active = Math.round(SEED_COUNT * (0.35 + (1 - sim.rainIntensity) * 0.5));
      for (let i = 0; i < SEED_COUNT; i += 1) {
        const seed = seeds[i];
        if (i >= active) {
          if (seed.alive) {
            seed.alive = false;
            dummy.position.set(0, -900, 0);
            dummy.scale.setScalar(0);
            dummy.updateMatrix();
            seedMesh.setMatrixAt(i, dummy.matrix);
          }
          continue;
        }
        if (!seed.alive) {
          seed.x = (Math.random() - 0.5) * 120;
          seed.z = (Math.random() - 0.5) * 70;
          seed.y = terrainHeight(seed.x, seed.z) + 1 + Math.random() * 5;
          seed.speed = 0.5 + Math.random() * 0.9;
          seed.alive = true;
        }

        seed.phase += dt * 0.7;
        seed.x += (sim.wind.x * sim.windStrength * 5 + Math.sin(seed.phase) * 0.5) * dt;
        seed.z += (sim.wind.z * sim.windStrength * 5 + Math.cos(seed.phase * 1.3) * 0.4) * dt;
        seed.y += seed.speed * dt;
        if (seed.y > 46) seed.alive = false;

        dummy.position.set(seed.x, seed.y, seed.z);
        dummy.rotation.set(seed.phase, seed.phase * 0.6, 0);
        dummy.scale.setScalar(0.35 + Math.sin(seed.phase * 2.0) * 0.05);
        dummy.updateMatrix();
        seedMesh.setMatrixAt(i, dummy.matrix);
      }
      seedMesh.instanceMatrix.needsUpdate = true;
      seedMesh.visible = active > 0;
    }
  });

  return (
    <group renderOrder={2}>
      <instancedMesh ref={rainRef} args={[undefined, undefined, RAIN_COUNT]} frustumCulled={false}>
        <cylinderGeometry args={[0.035, 0.035, 1.5, 4, 1, true]} />
        <meshBasicMaterial color="#dfe9ff" transparent opacity={0.42} depthWrite={false} />
      </instancedMesh>

      <instancedMesh ref={leafRef} args={[undefined, undefined, LEAF_COUNT]} frustumCulled={false}>
        <planeGeometry args={[0.85, 0.5]} />
        <meshBasicMaterial
          color="#e8b98a"
          transparent
          opacity={0.85}
          side={DoubleSide}
          depthWrite={false}
        />
      </instancedMesh>

      <instancedMesh ref={seedRef} args={[undefined, undefined, SEED_COUNT]} frustumCulled={false}>
        <sphereGeometry args={[0.42, 6, 5]} />
        <meshBasicMaterial color="#fdfaf3" transparent opacity={0.75} depthWrite={false} />
      </instancedMesh>
    </group>
  );
}
