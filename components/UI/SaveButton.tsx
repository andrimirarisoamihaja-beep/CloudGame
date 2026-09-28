"use client";

import { useState } from "react";
import { Camera, Check, Loader2, TriangleAlert } from "lucide-react";
import { useGameStore } from "@/lib/store";
import { buildSkyPayload, captureSky } from "@/lib/capture";

/**
 * Freezes the sky: screenshot → POST /api/skies → a quiet confirmation.
 * The save never blocks the game and never asks for a name.
 */
export default function SaveButton() {
  const setSaving = useGameStore((state) => state.setSaving);
  const isSaving = useGameStore((state) => state.isSaving);
  const pushToast = useGameStore((state) => state.pushToast);
  const [flash, setFlash] = useState<"idle" | "saved" | "error">("idle");

  const save = async () => {
    if (isSaving) return;
    setSaving(true);
    setFlash("idle");
    try {
      const screenshot = await captureSky();
      const response = await fetch("/api/skies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildSkyPayload(screenshot)),
      });
      if (!response.ok) {
        const detail = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(detail?.error ?? `Save failed (${response.status})`);
      }
      setFlash("saved");
      pushToast({ title: "Sky saved", subtitle: "It is waiting for you in the gallery" });
      window.setTimeout(() => setFlash("idle"), 1800);
    } catch (error) {
      setFlash("error");
      pushToast({
        title: "Could not save",
        subtitle: error instanceof Error ? error.message : "The sky slipped away",
      });
      window.setTimeout(() => setFlash("idle"), 2600);
    } finally {
      setSaving(false);
    }
  };

  const Icon = isSaving ? Loader2 : flash === "saved" ? Check : flash === "error" ? TriangleAlert : Camera;

  return (
    <button
      type="button"
      onClick={save}
      disabled={isSaving}
      title="Save this sky to the gallery"
      aria-label="Save this sky to the gallery"
      className={[
        "glass flex h-11 w-11 items-center justify-center rounded-2xl transition-all duration-200",
        isSaving ? "text-white/70" : "text-white/75 hover:bg-white/25 hover:text-white",
        flash === "error" ? "text-amber-200" : "",
      ].join(" ")}
    >
      <Icon size={19} strokeWidth={1.7} className={isSaving ? "animate-spin" : ""} />
    </button>
  );
}
