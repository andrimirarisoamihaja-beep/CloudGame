"use client";

import { useMemo } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ACESFilmicToneMapping, Vector3 } from "three";
import Sky from "./Sky";
import Sun from "./Sun";
import CloudManager from "./CloudManager";
import Landscape from "./Landscape";
import WeatherSystem from "./WeatherSystem";
import Particles from "./Particles";
import { registerRenderer } from "@/lib/capture";
import { sim } from "@/lib/engine";
import { damp } from "@/lib/utils";

const CAMERA_HOME = new Vector3(0, 8.5, 52);
const LOOK_HOME = new Vector3(0, 22, -10);

/**
 * The camera barely moves: it breathes with the pointer, so the sky feels
 * three-dimensional without ever taking control away from the player.
 */
function CameraRig() {
  const camera = useThree((state) => state.camera);
  const look = useMemo(() => LOOK_HOME.clone(), []);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const targetX = CAMERA_HOME.x + state.pointer.x * 4.5;
    const targetY = CAMERA_HOME.y - state.pointer.y * 2.6 + Math.sin(sim.time * 0.21) * 0.35;
    camera.position.x = damp(camera.position.x, targetX, 1.4, dt);
    camera.position.y = damp(camera.position.y, targetY, 1.4, dt);
    camera.position.z = damp(camera.position.z, CAMERA_HOME.z, 1.4, dt);
    look.set(
      LOOK_HOME.x + state.pointer.x * 2.2,
      LOOK_HOME.y - state.pointer.y * 1.2,
      LOOK_HOME.z,
    );
    camera.lookAt(look);
  });

  return null;
}

export default function GameCanvas() {
  return (
    <div
      id="game-root"
      className="fixed inset-0"
      onContextMenu={(event) => event.preventDefault()}
    >
      <Canvas
        dpr={[1, 1.35]}
        camera={{ position: [0, 8.5, 52], fov: 52, near: 0.5, far: 1400 }}
        gl={{
          antialias: false,
          alpha: false,
          stencil: false,
          // Required so html2canvas (and the fallback) can read the framebuffer.
          preserveDrawingBuffer: true,
          powerPreference: "high-performance",
        }}
        onCreated={({ gl, camera }) => {
          gl.toneMapping = ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.02;
          gl.setClearColor("#16203f", 1);
          camera.lookAt(LOOK_HOME);
          registerRenderer(gl);
        }}
      >
        <WeatherSystem />
        <CameraRig />
        <Sky />
        <Sun />
        <CloudManager />
        <Landscape />
        <Particles />
      </Canvas>
    </div>
  );
}
