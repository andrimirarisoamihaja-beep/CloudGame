"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Mesh, Plane, Vector2, Vector3 } from "three";
import Cloud, { type CloudHandlers } from "./Cloud";
import { getRuntime, measure, sim, syncClouds } from "@/lib/engine";
import { useGameStore } from "@/lib/store";
import { MAX_BLOBS, MAX_CLOUDS, MIN_DENSITY } from "@/lib/types";
import { clamp, clamp01 } from "@/lib/utils";
import { audio } from "@/lib/audio";
import { terrainHeight } from "@/lib/terrain";

/**
 * Every sculpting gesture lives here.
 *
 *   left click + hold      inflate the nearest blob           (puff tool)
 *   left click + drag      stretch that blob toward the cursor (any tool)
 *   left click (shape)     grab near the centre to fly the whole cloud
 *   left click (carve)     shrink the nearest blob
 *   left click (erase)     dissipate the cloud away
 *   right click            fracture the nearest blob into two
 *   scroll up / down       densify / dissipate
 *   drop onto a neighbour  the two clouds merge
 *   double click the sky   a new cloud is born
 *
 * Sculpting edits the runtime record directly (never React state) and is
 * mirrored into the store a few times per second, plus once on release.
 */

type InteractionMode = "inflate" | "shrink" | "stretch" | "move" | "dissipate";

interface Interaction {
  cloudId: string;
  mode: InteractionMode;
  pointerId: number;
  blobIndex: number;
  plane: Plane;
  grabOffset: Vector3;
  startX: number;
  startY: number;
  moved: boolean;
}

interface PinchState {
  cloudId: string;
  distance: number;
}

const CURSORS: Record<string, string> = {
  puff: "zoom-in",
  carve: "zoom-out",
  shape: "grab",
  erase: "crosshair",
};

const tmpHit = new Vector3();
const tmpLocal = new Vector3();
const tmpNormal = new Vector3();
const pointerNdc = new Vector2();

const MIN_ALTITUDE = 16;
const MAX_ALTITUDE = 64;
/** Pixels of travel before a press becomes a stretch instead of an inflate. */
const DRAG_THRESHOLD = 12;

export default function CloudManager() {
  const clouds = useGameStore((state) => state.clouds);
  const selectedCloudId = useGameStore((state) => state.selectedCloudId);
  const { camera, gl, raycaster } = useThree();

  const interactionRef = useRef<Interaction | null>(null);
  const pinchRef = useRef<PinchState | null>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number; cloudId: string }>());
  const commitClock = useRef(0);
  /** Cloud proxy meshes, so "did this click hit anything?" can be answered. */
  const meshesById = useMemo(() => new Map<string, Mesh>(), []);

  useEffect(() => {
    syncClouds(clouds);
  }, [clouds]);

  useEffect(() => {
    sim.selectedId = selectedCloudId;
  }, [selectedCloudId]);

  /** Mirror a sculpted cloud back into the store so it can be saved. */
  const commit = useCallback((cloudId: string) => {
    const runtime = getRuntime(cloudId);
    if (!runtime) return;
    runtime.dirty = false;
    useGameStore.getState().updateCloud(cloudId, {
      blobs: runtime.blobs.map((blob) => ({
        position: [...blob.position] as [number, number, number],
        radius: blob.radius,
      })),
      density: clamp01(runtime.density),
      position: [...runtime.position] as [number, number, number],
    });
  }, []);

  const endInteraction = useCallback(() => {
    const interaction = interactionRef.current;
    if (!interaction) return;
    const { cloudId, mode, moved } = interaction;
    interactionRef.current = null;
    document.body.style.cursor = "";

    const runtime = getRuntime(cloudId);
    if (runtime && (mode === "move" || mode === "stretch") && moved) {
      // Merge: a cloud dropped onto a neighbour is absorbed by it.
      for (const other of Array.from(sim.clouds.values())) {
        if (other.id === cloudId) continue;
        const distance = Math.hypot(
          other.position[0] - runtime.position[0],
          other.position[1] - runtime.position[1],
          other.position[2] - runtime.position[2],
        );
        if (distance >= (other.boundingRadius + runtime.boundingRadius) * 0.56) continue;

        const room = Math.max(0, MAX_BLOBS - other.blobs.length);
        const incoming = runtime.blobs
          .slice()
          .sort((a, b) => b.radius - a.radius)
          .slice(0, room);
        for (const blob of incoming) {
          other.blobs.push({
            position: [
              blob.position[0] + runtime.position[0] - other.position[0],
              blob.position[1] + runtime.position[1] - other.position[1],
              blob.position[2] + runtime.position[2] - other.position[2],
            ],
            radius: blob.radius * 0.94,
          });
        }
        other.density = clamp01((other.density + runtime.density) * 0.5 + 0.06);
        measure(other);
        other.dirty = false;
        runtime.dirty = false;
        const store = useGameStore.getState();
        store.updateCloud(other.id, {
          blobs: other.blobs.map((blob) => ({
            position: [...blob.position] as [number, number, number],
            radius: blob.radius,
          })),
          density: other.density,
        });
        store.removeCloud(cloudId);
        store.pushToast({ title: "Two became one", subtitle: "The clouds merged into one shape" });
        audio.playSculpt("inflate");
        return;
      }
    }
    commit(cloudId);
  }, [commit]);

  const nearestBlob = useCallback(
    (
      runtime: { blobs: { position: [number, number, number]; radius: number }[] },
      local: Vector3,
    ) => {
      let index = 0;
      let best = Infinity;
      for (let i = 0; i < runtime.blobs.length; i += 1) {
        const blob = runtime.blobs[i];
        const dx = blob.position[0] - local.x;
        const dy = blob.position[1] - local.y;
        const dz = blob.position[2] - local.z;
        // Prefer the blob whose *surface* is closest, not its centre.
        const score = Math.sqrt(dx * dx + dy * dy + dz * dz) - blob.radius * 0.45;
        if (score < best) {
          best = score;
          index = i;
        }
      }
      return index;
    },
    [],
  );

  const handlers = useMemo<CloudHandlers>(() => {
    const cloudIdFrom = (
      event: ThreeEvent<PointerEvent> | ThreeEvent<WheelEvent> | ThreeEvent<MouseEvent>,
    ) => (event.object as Mesh).userData?.cloudId as string | undefined;

    const onPointerDown = (event: ThreeEvent<PointerEvent>) => {
      const cloudId = cloudIdFrom(event);
      if (!cloudId) return;
      const runtime = getRuntime(cloudId);
      if (!runtime) return;

      event.stopPropagation();
      const target = event.target as unknown as { setPointerCapture?: (id: number) => void };
      target.setPointerCapture?.(event.pointerId);

      pointersRef.current.set(event.pointerId, {
        x: event.nativeEvent.clientX,
        y: event.nativeEvent.clientY,
        cloudId,
      });

      const store = useGameStore.getState();
      store.selectCloud(cloudId);
      sim.selectedId = cloudId;

      // A second finger on the same cloud starts a pinch (density).
      const active = Array.from(pointersRef.current.values()).filter((p) => p.cloudId === cloudId);
      if (active.length >= 2) {
        interactionRef.current = null;
        pinchRef.current = {
          cloudId,
          distance: Math.hypot(active[0].x - active[1].x, active[0].y - active[1].y),
        };
        return;
      }

      const tool = store.tool;
      const center = new Vector3(runtime.position[0], runtime.position[1], runtime.position[2]);
      const local = tmpLocal.copy(event.point).sub(center);
      const blobIndex = nearestBlob(runtime, local);

      camera.getWorldDirection(tmpNormal);
      const plane = new Plane().setFromNormalAndCoplanarPoint(tmpNormal, center);

      let mode: InteractionMode = "inflate";
      if (tool === "carve") mode = "shrink";
      else if (tool === "erase") mode = "dissipate";
      else if (tool === "shape") {
        mode = local.length() < runtime.boundingRadius * 0.34 ? "move" : "stretch";
      }

      runtime.dirty = true;
      interactionRef.current = {
        cloudId,
        mode,
        pointerId: event.pointerId,
        blobIndex,
        plane,
        grabOffset: new Vector3().copy(event.point).sub(center),
        startX: event.nativeEvent.clientX,
        startY: event.nativeEvent.clientY,
        moved: false,
      };

      if (mode === "inflate") audio.playSculpt("inflate");
      if (mode === "dissipate") audio.playSculpt("deflate");
      document.body.style.cursor = mode === "move" ? "grabbing" : (CURSORS[tool] ?? "grab");
    };

    const onPointerMove = (event: ThreeEvent<PointerEvent>) => {
      const cloudId = cloudIdFrom(event);
      if (!cloudId) return;
      const record = pointersRef.current.get(event.pointerId);
      if (record) {
        record.x = event.nativeEvent.clientX;
        record.y = event.nativeEvent.clientY;
      }

      const pinch = pinchRef.current;
      if (pinch && pinch.cloudId === cloudId) {
        const active = Array.from(pointersRef.current.values()).filter((p) => p.cloudId === cloudId);
        if (active.length >= 2) {
          const distance = Math.hypot(active[0].x - active[1].x, active[0].y - active[1].y);
          const delta = distance - pinch.distance;
          pinch.distance = distance;
          const runtime = getRuntime(cloudId);
          if (runtime && Math.abs(delta) > 0.5) {
            runtime.dirty = true;
            runtime.density = clamp01(runtime.density + delta * 0.004);
            if (runtime.density < MIN_DENSITY) {
              useGameStore.getState().removeCloud(cloudId);
              pinchRef.current = null;
              return;
            }
            measure(runtime);
          }
        }
        return;
      }

      const interaction = interactionRef.current;
      if (!interaction || interaction.cloudId !== cloudId) return;
      const travel = Math.hypot(
        event.nativeEvent.clientX - interaction.startX,
        event.nativeEvent.clientY - interaction.startY,
      );
      // Hold to inflate; drag to stretch. One gesture, two meanings.
      if (interaction.mode === "inflate" && travel > DRAG_THRESHOLD) {
        interaction.mode = "stretch";
        document.body.style.cursor = "grabbing";
      }
      if (travel > 3) interaction.moved = true;
    };

    const onPointerUp = (event: ThreeEvent<PointerEvent>) => {
      pointersRef.current.delete(event.pointerId);
      const cloudId = cloudIdFrom(event);

      const pinch = pinchRef.current;
      if (pinch) {
        const active = Array.from(pointersRef.current.values()).filter((p) => p.cloudId === pinch.cloudId);
        if (active.length < 2) {
          commit(pinch.cloudId);
          pinchRef.current = null;
        }
      }

      const interaction = interactionRef.current;
      if (interaction && (!cloudId || interaction.cloudId === cloudId)) endInteraction();

      if (cloudId && !interactionRef.current) {
        document.body.style.cursor = CURSORS[useGameStore.getState().tool] ?? "grab";
      }
    };

    const onPointerOver = (event: ThreeEvent<PointerEvent>) => {
      if (!cloudIdFrom(event)) return;
      useGameStore.getState().setHovering(true);
      if (!interactionRef.current) {
        document.body.style.cursor = CURSORS[useGameStore.getState().tool] ?? "grab";
      }
    };

    const onPointerOut = () => {
      useGameStore.getState().setHovering(false);
      if (!interactionRef.current) document.body.style.cursor = "";
    };

    const onWheel = (event: ThreeEvent<WheelEvent>) => {
      const cloudId = cloudIdFrom(event);
      if (!cloudId) return;
      const runtime = getRuntime(cloudId);
      if (!runtime) return;
      event.stopPropagation();
      event.nativeEvent.preventDefault?.();
      runtime.dirty = true;
      runtime.density = clamp01(runtime.density - event.deltaY * 0.0016);
      if (runtime.density < MIN_DENSITY) {
        useGameStore.getState().removeCloud(cloudId);
        return;
      }
      measure(runtime);
      commit(cloudId);
    };

    const onContextMenu = (event: ThreeEvent<MouseEvent>) => {
      const cloudId = cloudIdFrom(event);
      if (!cloudId) return;
      event.stopPropagation();
      event.nativeEvent.preventDefault?.();
      const runtime = getRuntime(cloudId);
      if (!runtime || runtime.blobs.length === 0 || runtime.blobs.length >= MAX_BLOBS) return;

      const center = new Vector3(runtime.position[0], runtime.position[1], runtime.position[2]);
      const local = tmpLocal.copy(event.point).sub(center);
      const index = nearestBlob(runtime, local);
      const blob = runtime.blobs[index];
      const radius = Math.max(0.7, blob.radius * 0.66);
      const angle = Math.random() * Math.PI * 2;
      const offset = blob.radius * 0.8;
      runtime.blobs.splice(index, 1);
      runtime.blobs.push({
        position: [
          blob.position[0] + Math.cos(angle) * offset,
          blob.position[1] + (Math.random() - 0.5) * offset * 0.6,
          blob.position[2] + Math.sin(angle) * offset,
        ],
        radius,
      });
      runtime.blobs.push({
        position: [
          blob.position[0] - Math.cos(angle) * offset,
          blob.position[1] + (Math.random() - 0.5) * offset * 0.6,
          blob.position[2] - Math.sin(angle) * offset,
        ],
        radius,
      });
      runtime.density = clamp01(runtime.density - 0.04);
      runtime.dirty = true;
      measure(runtime);
      commit(cloudId);
      audio.playSculpt("fracture");
    };

    return {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerOver,
      onPointerOut,
      onWheel,
      onContextMenu,
    };
  }, [camera, commit, endInteraction, nearestBlob]);

  /** Continuous gestures, scaled by real time. */
  useFrame((state, delta) => {
    const interaction = interactionRef.current;
    if (!interaction) return;
    const runtime = getRuntime(interaction.cloudId);
    if (!runtime) {
      interactionRef.current = null;
      return;
    }

    const dt = Math.min(delta, 0.05);
    runtime.dirty = true;

    if (interaction.mode === "inflate" || interaction.mode === "shrink") {
      const blob = runtime.blobs[interaction.blobIndex];
      if (blob) {
        const direction = interaction.mode === "inflate" ? 1 : -1;
        blob.radius = clamp(blob.radius + direction * dt * 2.4, 0.45, 9);
        if (interaction.mode === "shrink" && blob.radius <= 0.5 && runtime.blobs.length > 1) {
          runtime.blobs.splice(interaction.blobIndex, 1);
          interaction.blobIndex = 0;
        }
        measure(runtime);
      }
    } else if (interaction.mode === "dissipate") {
      runtime.density = clamp01(runtime.density - dt * 0.85);
      if (runtime.density < MIN_DENSITY) {
        interactionRef.current = null;
        runtime.dirty = false;
        useGameStore.getState().removeCloud(interaction.cloudId);
        return;
      }
      measure(runtime);
    } else if (interaction.mode === "stretch" || interaction.mode === "move") {
      raycaster.setFromCamera(state.pointer, state.camera);
      const hit = raycaster.ray.intersectPlane(interaction.plane, tmpHit);
      if (hit) {
        if (interaction.mode === "move") {
          const next = tmpHit.sub(interaction.grabOffset);
          runtime.position[0] = clamp(next.x, -110, 110);
          runtime.position[1] = clamp(next.y, runtime.groundY + MIN_ALTITUDE * 0.6, MAX_ALTITUDE + 12);
          runtime.position[2] = clamp(next.z, -70, 70);
          runtime.groundY = terrainHeight(runtime.position[0], runtime.position[2]);
        } else {
          const blob = runtime.blobs[interaction.blobIndex];
          if (blob) {
            const localX = tmpHit.x - runtime.position[0];
            const localY = tmpHit.y - runtime.position[1];
            const localZ = tmpHit.z - runtime.position[2];
            const k = Math.min(1, dt * 4.5);
            blob.position[0] += (localX - blob.position[0]) * k;
            blob.position[1] += (localY - blob.position[1]) * k;
            blob.position[2] += (localZ - blob.position[2]) * k;
            const limit = Math.max(2, runtime.boundingRadius * 0.78 - blob.radius * 0.5);
            const length = Math.hypot(blob.position[0], blob.position[1], blob.position[2]);
            if (length > limit) {
              const scale = limit / length;
              blob.position[0] *= scale;
              blob.position[1] *= scale;
              blob.position[2] *= scale;
            }
            measure(runtime);
          }
        }
      }
    }

    commitClock.current += dt;
    if (commitClock.current > 0.35) {
      commitClock.current = 0;
      commit(interaction.cloudId);
    }
  });

  /**
   * Double click on empty sky creates a cloud. A native listener is used because
   * R3F events only fire for objects that exist — here the interesting case is
   * the *absence* of a hit, which we confirm with a real raycast.
   */
  useEffect(() => {
    const element = gl.domElement;

    const onDoubleClick = (event: MouseEvent) => {
      const rect = element.getBoundingClientRect();
      pointerNdc.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointerNdc, camera);

      const meshes = Array.from(meshesById.values());
      const hits = meshes.length > 0 ? raycaster.intersectObjects(meshes, false) : [];

      if (hits.length > 0) {
        const cloudId = (hits[0].object as Mesh).userData?.cloudId as string | undefined;
        const runtime = cloudId ? getRuntime(cloudId) : undefined;
        const blob = runtime?.blobs[0];
        if (runtime && blob) {
          blob.radius = Math.min(9, blob.radius + 0.7);
          runtime.dirty = true;
          measure(runtime);
          commit(cloudId as string);
          audio.playSculpt("inflate");
        }
        return;
      }

      const store = useGameStore.getState();
      if (store.clouds.length >= MAX_CLOUDS) {
        store.pushToast({ title: "The sky is full", subtitle: "Let a cloud drift away before adding more" });
        return;
      }

      // Place the new cloud where the ray crosses a comfortable altitude.
      const ray = raycaster.ray;
      const targetAltitude = 34;
      let distance = ray.direction.y > 0.06 ? (targetAltitude - ray.origin.y) / ray.direction.y : 78;
      distance = clamp(distance, 42, 150);
      const point = new Vector3().copy(ray.origin).addScaledVector(ray.direction, distance);
      point.y = clamp(point.y, MIN_ALTITUDE + 6, MAX_ALTITUDE);
      point.x = clamp(point.x, -95, 95);
      point.z = clamp(point.z, -55, 55);

      if (store.addCloud([point.x, point.y, point.z], 0.6)) audio.playSculpt("create");
    };

    element.addEventListener("dblclick", onDoubleClick);
    return () => element.removeEventListener("dblclick", onDoubleClick);
  }, [camera, commit, gl, meshesById, raycaster]);

  const register = useCallback(
    (id: string, mesh: Mesh | null) => {
      if (mesh) meshesById.set(id, mesh);
      else meshesById.delete(id);
    },
    [meshesById],
  );

  return (
    <group>
      {clouds.map((cloud) => (
        <Cloud key={cloud.id} id={cloud.id} handlers={handlers} register={register} />
      ))}
    </group>
  );
}
