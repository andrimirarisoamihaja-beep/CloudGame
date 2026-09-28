"use client";

import { memo, useEffect, useMemo, useRef } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { BackSide, Mesh, ShaderMaterial, Vector3, Vector4 } from "three";
import { cloudFragmentShader } from "@/shaders/cloudFragment.glsl";
import { cloudVertexShader } from "@/shaders/cloudVertex.glsl";
import { getRuntime, sim, type RuntimeCloud } from "@/lib/engine";
import { MAX_BLOBS } from "@/lib/types";

export interface CloudHandlers {
  onPointerDown: (event: ThreeEvent<PointerEvent>) => void;
  onPointerMove: (event: ThreeEvent<PointerEvent>) => void;
  onPointerUp: (event: ThreeEvent<PointerEvent>) => void;
  onPointerOver: (event: ThreeEvent<PointerEvent>) => void;
  onPointerOut: (event: ThreeEvent<PointerEvent>) => void;
  onWheel: (event: ThreeEvent<WheelEvent>) => void;
  onContextMenu: (event: ThreeEvent<MouseEvent>) => void;
}

export interface CloudProps {
  id: string;
  handlers: CloudHandlers;
  register: (id: string, mesh: Mesh | null) => void;
}

/**
 * One cloud: a bounding sphere whose fragment shader raymarches the blob field.
 *
 * React only knows the cloud's id — every animated value is read from the
 * runtime record in `lib/engine.ts` inside `useFrame`, so sculpting, wind and
 * the day/night cycle never trigger a re-render.
 */
function CloudImpl({ id, handlers, register }: CloudProps) {
  const meshRef = useRef<Mesh>(null);
  const materialRef = useRef<ShaderMaterial>(null);

  // The manager keeps a registry of proxies so it can tell "clicked the sky"
  // from "clicked a cloud" without a second raycast pass per pointer event.
  useEffect(() => {
    register(id, meshRef.current);
    return () => register(id, null);
  }, [id, register]);

  const uniforms = useMemo(
    () => ({
      u_time: { value: 0 },
      u_density: { value: 0.6 },
      u_radius: { value: 6 },
      u_center: { value: new Vector3() },
      u_lightColor: { value: new Vector3(1, 0.97, 0.9) },
      u_shadowColor: { value: new Vector3(0.42, 0.48, 0.62) },
      u_ambientColor: { value: new Vector3(0.62, 0.74, 0.9) },
      u_sunColor: { value: new Vector3(1, 0.97, 0.9) },
      u_sunDir: { value: new Vector3(0.4, 0.8, -0.3).normalize() },
      u_sunIntensity: { value: 1.1 },
      u_blobCount: { value: 3 },
      u_blobs: {
        value: Array.from({ length: MAX_BLOBS }, () => new Vector4(0, 0, 0, 1)),
      },
      u_lean: { value: new Vector3() },
      u_phase: { value: 0 },
      u_noiseScale: { value: 0.42 },
      u_wispiness: { value: 1.0 },
      u_extinction: { value: 1.35 },
      u_selected: { value: 0 },
      u_fade: { value: 0 },
      u_haze: { value: 1 },
      u_steps: { value: 34 },
      u_octaves: { value: 5 },
    }),
    [],
  );

  useFrame((_, delta) => {
    const runtime: RuntimeCloud | undefined = getRuntime(id);
    const mesh = meshRef.current;
    if (!runtime || !mesh) return;

    // Spawn / dissolve fade.
    const dt = Math.min(delta, 0.1);
    runtime.glow += ((sim.selectedId === id ? 1 : 0) - runtime.glow) * Math.min(1, dt * 6);
    runtime.fade = Math.min(1, runtime.fade + dt * 0.9);

    mesh.position.set(runtime.position[0], runtime.position[1], runtime.position[2]);
    mesh.scale.setScalar(runtime.boundingRadius);
    mesh.visible = runtime.fade > 0.01;

    const material = materialRef.current;
    if (!material) return;
    const u = material.uniforms;

    u.u_time.value = sim.time;
    u.u_density.value = runtime.density;
    u.u_radius.value = runtime.boundingRadius;
    u.u_center.value.copy(mesh.position);
    u.u_lightColor.value.set(sim.lightColor.r, sim.lightColor.g, sim.lightColor.b);
    u.u_shadowColor.value.set(sim.shadowColor.r, sim.shadowColor.g, sim.shadowColor.b);
    u.u_ambientColor.value.set(sim.ambientColor.r, sim.ambientColor.g, sim.ambientColor.b);
    u.u_sunColor.value.set(sim.sunColor.r, sim.sunColor.g, sim.sunColor.b);
    u.u_sunDir.value.copy(sim.cloudSunDir);
    u.u_sunIntensity.value = sim.sunIntensity;
    u.u_lean.value.set(runtime.lean[0], runtime.lean[1], runtime.lean[2]);
    u.u_phase.value = runtime.phase;
    u.u_selected.value = runtime.glow;
    u.u_fade.value = runtime.fade;
    u.u_steps.value = sim.steps;
    u.u_octaves.value = sim.octaves;
    // Thicker air in wet weather: clouds read heavier and hazier.
    u.u_haze.value = 0.7 + sim.overcast * 0.6;
    u.u_extinction.value = 1.15 + runtime.density * 0.55;
    u.u_wispiness.value = 0.85 + (1 - runtime.density) * 0.5;

    const count = Math.min(runtime.blobs.length, MAX_BLOBS);
    u.u_blobCount.value = count;
    const blobs = u.u_blobs.value as Vector4[];
    for (let i = 0; i < count; i += 1) {
      const blob = runtime.blobs[i];
      blobs[i].set(blob.position[0], blob.position[1], blob.position[2], blob.radius);
    }
  });

  return (
    <mesh
      ref={meshRef}
      userData={{ cloudId: id }}
      onPointerDown={handlers.onPointerDown}
      onPointerMove={handlers.onPointerMove}
      onPointerUp={handlers.onPointerUp}
      onPointerOver={handlers.onPointerOver}
      onPointerOut={handlers.onPointerOut}
      onWheel={handlers.onWheel}
      onContextMenu={handlers.onContextMenu}
    >
      <sphereGeometry args={[1, 20, 14]} />
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        vertexShader={cloudVertexShader}
        fragmentShader={cloudFragmentShader}
        transparent
        depthWrite={false}
        premultipliedAlpha
        side={BackSide}
      />
    </mesh>
  );
}

export default memo(CloudImpl);
