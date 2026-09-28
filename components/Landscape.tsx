"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { MeshReflectorMaterial } from "@react-three/drei";
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  InstancedMesh,
  MeshStandardMaterial,
  Object3D,
} from "three";
import { sim } from "@/lib/engine";
import {
  LAKE_CENTER,
  LAKE_SURFACE,
  TERRAIN_SIZE,
  VILLAGE_CENTER,
  flowerPatches,
  scatterPoints,
  terrainHeight,
} from "@/lib/terrain";
import { clamp01, damp } from "@/lib/utils";

/**
 * The miniature world below the clouds: hills, a lake, a village, trees and
 * flower patches. Everything is placed on the shared height field in
 * `lib/terrain.ts`, so nothing floats and nothing sinks.
 *
 * The landscape reacts to the sky: windows light up when a thick cloud passes
 * overhead, flowers open where the rain falls, and a well-watered valley slowly
 * grows new trees and houses.
 */

const TERRAIN_SEGMENTS = 72;
const HOUSE_COUNT = 10;
const TREE_COUNT = 34;
const FLOWER_COUNT = 64;
const BASE_TREES = 16;

const GRASS_LIGHT = new Color("#8fb866");
const GRASS_DARK = new Color("#4f7a4a");
const SAND = new Color("#cbbd94");
const ROCK = new Color("#97937f");

/** Builds the displaced, vertex-coloured terrain once at mount. */
function buildTerrainGeometry(): BufferGeometry {
  const geometry = new BufferGeometry();
  const grid = TERRAIN_SEGMENTS + 1;
  const half = TERRAIN_SIZE / 2;
  const step = TERRAIN_SIZE / TERRAIN_SEGMENTS;

  // Sample the height field once, then derive slopes from the grid.
  const heights = new Float32Array(grid * grid);
  for (let j = 0; j < grid; j += 1) {
    for (let i = 0; i < grid; i += 1) {
      const x = -half + i * step;
      const z = -half + j * step;
      heights[j * grid + i] = terrainHeight(x, z);
    }
  }

  const positions = new Float32Array(grid * grid * 3);
  const colors = new Float32Array(grid * grid * 3);
  const color = new Color();

  for (let j = 0; j < grid; j += 1) {
    for (let i = 0; i < grid; i += 1) {
      const index = j * grid + i;
      const x = -half + i * step;
      const z = -half + j * step;
      const y = heights[index];
      positions[index * 3] = x;
      positions[index * 3 + 1] = y;
      positions[index * 3 + 2] = z;

      // Slope from neighbouring samples (cheap finite difference).
      const left = heights[j * grid + Math.max(0, i - 1)];
      const right = heights[j * grid + Math.min(grid - 1, i + 1)];
      const up = heights[Math.max(0, j - 1) * grid + i];
      const down = heights[Math.min(grid - 1, j + 1) * grid + i];
      const slope = Math.hypot(right - left, down - up) / (2 * step);

      // Valleys are darker and damper, ridges lighter.
      const heightMix = clamp01((y + 4) / 18);
      color.copy(GRASS_DARK).lerp(GRASS_LIGHT, heightMix);

      if (y < LAKE_SURFACE + 1.1) {
        color.lerp(SAND, clamp01((LAKE_SURFACE + 1.1 - y) / 1.6) * 0.75);
      }
      color.lerp(ROCK, clamp01((slope - 0.45) / 0.9) * 0.65);

      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
    }
  }

  const indices: number[] = [];
  for (let j = 0; j < TERRAIN_SEGMENTS; j += 1) {
    for (let i = 0; i < TERRAIN_SEGMENTS; i += 1) {
      const a = j * grid + i;
      const b = a + 1;
      const c = a + grid;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Traces the shoreline so the water never floats above the ground. */
function buildLakeGeometry(): BufferGeometry {
  const segments = 56;
  const radii = new Float32Array(segments);
  for (let i = 0; i < segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    let radius = 2;
    for (let r = 1; r <= 44; r += 1) {
      const x = LAKE_CENTER[0] + Math.cos(angle) * r;
      const z = LAKE_CENTER[1] + Math.sin(angle) * r;
      if (terrainHeight(x, z) > LAKE_SURFACE - 0.12) break;
      radius = r;
    }
    radii[i] = radius;
  }

  const positions = new Float32Array((segments + 2) * 3);
  positions[0] = LAKE_CENTER[0];
  positions[1] = LAKE_SURFACE;
  positions[2] = LAKE_CENTER[1];
  for (let i = 0; i <= segments; i += 1) {
    const index = i + 1;
    const angle = ((i % segments) / segments) * Math.PI * 2;
    positions[index * 3] = LAKE_CENTER[0] + Math.cos(angle) * radii[i % segments];
    positions[index * 3 + 1] = LAKE_SURFACE;
    positions[index * 3 + 2] = LAKE_CENTER[1] + Math.sin(angle) * radii[i % segments];
  }

  const indices: number[] = [];
  for (let i = 1; i <= segments; i += 1) {
    indices.push(0, i, i + 1);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function Terrain() {
  const geometry = useMemo(buildTerrainGeometry, []);
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial vertexColors flatShading roughness={0.96} metalness={0} />
    </mesh>
  );
}

function Lake() {
  const geometry = useMemo(buildLakeGeometry, []);
  return (
    <mesh geometry={geometry} renderOrder={-10}>
      <MeshReflectorMaterial
        resolution={256}
        mixBlur={0.4}
        mixStrength={1.6}
        mirror={0.55}
        blur={[0, 0]}
        roughness={0.22}
        depthScale={0.6}
        minDepthThreshold={0.3}
        maxDepthThreshold={1.2}
        color="#5c7f96"
        metalness={0.12}
      />
    </mesh>
  );
}

interface HouseProps {
  position: [number, number, number];
  rotation: number;
  scale: number;
  index: number;
}

/** One cottage: walls, a pyramid roof, a chimney and two windows that light up. */
function House({ position, rotation, scale, index }: HouseProps) {
  const groupRef = useRef<Group>(null);
  const roofRef = useRef<MeshStandardMaterial>(null);
  const lit = useRef(0);
  const grown = useRef(0);

  // One material shared by both windows so a house lights up as a whole.
  const windowMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: new Color("#f6e6c4"),
        emissive: new Color("#ffd98a"),
        emissiveIntensity: 0.1,
        roughness: 0.6,
      }),
    [],
  );

  const wallColor = useMemo(
    () => (index % 3 === 0 ? "#efe6d6" : index % 3 === 1 ? "#e7dcc6" : "#f3ece0"),
    [index],
  );
  const roofColor = useMemo(
    () => (index % 2 === 0 ? "#b9756a" : "#8d8778"),
    [index],
  );

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const group = groupRef.current;
    if (!group) return;

    const shouldExist = index < sim.housesBuilt;
    grown.current = damp(grown.current, shouldExist ? 1 : 0, 1.6, dt);
    const grownValue = grown.current;
    group.visible = grownValue > 0.02;
    if (!group.visible) return;
    // Pop up with a little overshoot.
    const s = scale * (grownValue < 1 ? 0.6 + grownValue * 0.5 : 1);
    group.scale.set(s, s * (0.4 + grownValue * 0.6), s);

    // Windows glow when the sky darkens — a thick cloud overhead counts.
    let shade = 0;
    for (const runtime of sim.clouds.values()) {
      if (runtime.density < 0.55) continue;
      const dx = runtime.position[0] - position[0];
      const dz = runtime.position[2] - position[2];
      const distance = Math.hypot(dx, dz);
      if (distance < runtime.boundingRadius * 0.9) {
        shade = Math.max(shade, clamp01(1 - distance / (runtime.boundingRadius * 0.9)));
      }
    }
    const target = Math.max(shade * 0.85, sim.nightLights, sim.overcast * 0.35, sim.flash * 0.5);
    lit.current = damp(lit.current, target, 3, dt);

    windowMaterial.emissiveIntensity = 0.05 + lit.current * 2.4;
    windowMaterial.color.setRGB(1, 0.92 - lit.current * 0.12, 0.72 - lit.current * 0.24);
    if (roofRef.current) {
      roofRef.current.emissiveIntensity = lit.current * 0.05;
    }
  });

  return (
    <group ref={groupRef} position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, 1.25, 0]} castShadow={false}>
        <boxGeometry args={[3.1, 2.5, 3.1]} />
        <meshStandardMaterial color={wallColor} roughness={0.85} flatShading />
      </mesh>
      <mesh position={[0, 3.4, 0]} rotation={[0, Math.PI / 4, 0]}>
        <coneGeometry args={[2.65, 2.1, 4]} />
        <meshStandardMaterial ref={roofRef} color={roofColor} roughness={0.8} flatShading />
      </mesh>
      <mesh position={[0.95, 4.3, 0.7]}>
        <boxGeometry args={[0.4, 1.1, 0.4]} />
        <meshStandardMaterial color="#8d8778" roughness={0.9} flatShading />
      </mesh>
      <mesh position={[-0.75, 1.5, 1.57]} material={windowMaterial}>
        <planeGeometry args={[0.72, 0.62]} />
      </mesh>
      <mesh position={[0.75, 1.5, 1.57]} material={windowMaterial}>
        <planeGeometry args={[0.72, 0.62]} />
      </mesh>
      <mesh position={[0, 0.95, 1.57]}>
        <planeGeometry args={[0.62, 1.1]} />
        <meshStandardMaterial color="#7d6a58" roughness={0.9} />
      </mesh>
    </group>
  );
}

function Village() {
  const houses = useMemo(
    () =>
      scatterPoints(HOUSE_COUNT, {
        seed: 4242,
        radius: [4, 25],
        center: VILLAGE_CENTER,
        minSlope: 0.35,
      }),
    [],
  );

  return (
    <group>
      {houses.map((position, index) => (
        <House
          key={`house-${index}`}
          index={index}
          position={position}
          rotation={(index * 1.37) % (Math.PI * 2)}
          scale={0.85 + ((index * 7) % 5) * 0.12}
        />
      ))}
    </group>
  );
}

/** Trees and flowers appear as the valley is rained on. */
function Trees() {
  const trunkRef = useRef<InstancedMesh>(null);
  const foliageRef = useRef<InstancedMesh>(null);
  const growth = useRef<number[]>([]);
  const dummy = useMemo(() => new Object3D(), []);

  const positions = useMemo(
    () =>
      scatterPoints(TREE_COUNT, {
        seed: 9091,
        radius: [12, 95],
        center: [0, 0],
        minSlope: 0.5,
      }),
    [],
  );

  if (growth.current.length !== positions.length) {
    growth.current = positions.map(() => 0);
  }

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const trunks = trunkRef.current;
    const foliage = foliageRef.current;
    if (!trunks || !foliage) return;

    const active = Math.min(BASE_TREES + sim.treesGrown, positions.length);
    let drawn = 0;

    for (let i = 0; i < positions.length; i += 1) {
      const [x, y, z] = positions[i];
      const target = i < active ? 1 : 0;
      growth.current[i] = damp(growth.current[i], target, 1.1, dt);
      const g = growth.current[i];
      if (g < 0.02) continue;

      const scale = 0.75 + ((i * 13) % 7) * 0.09;
      const s = scale * (0.35 + g * 0.65);
      const sway = Math.sin(sim.time * 0.9 + i) * 0.02 * sim.windStrength;

      dummy.position.set(x, y + 1.1 * s, z);
      dummy.rotation.set(sway, i * 0.7, sway * 0.6);
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      trunks.setMatrixAt(drawn, dummy.matrix);

      dummy.position.set(x, y + (1.1 + 2.6) * s, z);
      dummy.rotation.set(sway * 1.4, i * 0.7, sway);
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      foliage.setMatrixAt(drawn, dummy.matrix);

      drawn += 1;
    }

    trunks.count = drawn;
    foliage.count = drawn;
    trunks.instanceMatrix.needsUpdate = true;
    foliage.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh ref={trunkRef} args={[undefined, undefined, TREE_COUNT]} frustumCulled={false}>
        <cylinderGeometry args={[0.16, 0.26, 2.2, 5]} />
        <meshStandardMaterial color="#7a5a44" roughness={0.9} flatShading />
      </instancedMesh>
      <instancedMesh ref={foliageRef} args={[undefined, undefined, TREE_COUNT]} frustumCulled={false}>
        <coneGeometry args={[1.5, 5.2, 6]} />
        <meshStandardMaterial color="#5c8f52" roughness={0.9} flatShading />
      </instancedMesh>
    </group>
  );
}

/** Flower patches open where rain actually lands. */
function Flowers() {
  const meshRef = useRef<InstancedMesh>(null);
  const levels = useRef<number[]>([]);
  const lastHead = useRef(0);
  const dummy = useMemo(() => new Object3D(), []);
  const color = useMemo(() => new Color(), []);

  const patches = useMemo(() => flowerPatches(FLOWER_COUNT), []);

  if (levels.current.length !== patches.length) {
    levels.current = patches.map(() => 0);
  }

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    // Consume the rain impacts recorded since the last frame. The ring buffer
    // wraps on its *capacity*, never on the number of hits recorded so far.
    const buffer = sim.rainHits;
    const capacity = buffer.x.length;
    if (capacity > 0 && buffer.head !== lastHead.current) {
      let cursor = lastHead.current;
      let guard = 0;
      while (cursor !== buffer.head && guard < capacity) {
        guard += 1;
        const hx = buffer.x[cursor];
        const hz = buffer.z[cursor];
        cursor = (cursor + 1) % capacity;
        for (let i = 0; i < patches.length; i += 1) {
          const [px, , pz] = patches[i];
          if (Math.hypot(px - hx, pz - hz) < 5.5) {
            levels.current[i] = Math.min(1, levels.current[i] + 0.09);
          }
        }
      }
      lastHead.current = buffer.head;
    }

    for (let i = 0; i < patches.length; i += 1) {
      const [x, y, z] = patches[i];
      const level = levels.current[i];
      if (level < 0.02) {
        dummy.scale.setScalar(0);
        dummy.position.set(x, y - 10, z);
      } else {
        const s = level * (0.9 + ((i * 7) % 5) * 0.08);
        dummy.position.set(x, y + 0.22 * s, z);
        dummy.scale.set(s, s, s);
      }
      dummy.rotation.set(0, i, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      const hue = 0.86 + ((i * 37) % 100) / 100 * 0.28;
      color.setHSL(hue % 1, 0.55, 0.72 + level * 0.08);
      mesh.setColorAt(i, color);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, FLOWER_COUNT]} frustumCulled={false}>
      <sphereGeometry args={[0.34, 6, 5]} />
      <meshStandardMaterial roughness={0.7} vertexColors={false} />
    </instancedMesh>
  );
}

export default function Landscape() {
  return (
    <group>
      <Terrain />
      <Lake />
      <Village />
      <Trees />
      <Flowers />
    </group>
  );
}

export type { HouseProps };
