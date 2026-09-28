"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { BackSide, ShaderMaterial, Vector3 } from "three";
import { skyFragmentShader } from "@/shaders/skyFragment.glsl";
import { skyVertexShader } from "@/shaders/skyVertex.glsl";
import { sim } from "@/lib/engine";

/**
 * The sky dome: one inverted sphere, no textures, every colour computed from
 * `u_timeOfDay`. It is drawn first, without touching the depth buffer, so the
 * landscape and the clouds simply paint over it.
 */
export default function Sky() {
  const materialRef = useRef<ShaderMaterial>(null);

  const uniforms = useMemo(
    () => ({
      u_time: { value: 0 },
      u_timeOfDay: { value: sim.timeOfDay },
      u_sunDir: { value: new Vector3().copy(sim.sunDir) },
      u_moonDir: { value: new Vector3().copy(sim.moonDir) },
      u_flash: { value: 0 },
      u_overcast: { value: 0 },
      u_cloudCover: { value: 0 },
      u_exposure: { value: 1 },
    }),
    [],
  );

  useFrame(() => {
    const uniformsRef = materialRef.current?.uniforms;
    if (!uniformsRef) return;
    uniformsRef.u_time.value = sim.time;
    uniformsRef.u_timeOfDay.value = sim.timeOfDay;
    uniformsRef.u_sunDir.value.copy(sim.sunDir);
    uniformsRef.u_moonDir.value.copy(sim.moonDir);
    uniformsRef.u_flash.value = sim.flash;
    uniformsRef.u_overcast.value = sim.overcast;
    uniformsRef.u_cloudCover.value = sim.cloudCover;
    uniformsRef.u_exposure.value = 0.85 + sim.paletteExposure * 0.25;
  });

  return (
    <mesh renderOrder={-1000} frustumCulled={false}>
      <sphereGeometry args={[460, 48, 32]} />
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        vertexShader={skyVertexShader}
        fragmentShader={skyFragmentShader}
        side={BackSide}
        depthWrite={false}
        depthTest={false}
        transparent={false}
      />
    </mesh>
  );
}
