"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { useGameStore } from "@/lib/store";

/**
 * Soft challenges: a quiet ribbon at the top of the sky that fades away on its
 * own. No sound, no interruption, nothing to dismiss.
 */
export default function ChallengeToast() {
  const toast = useGameStore((state) => state.toast);
  const dismissToast = useGameStore((state) => state.dismissToast);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!toast) return;
    setLeaving(false);
    const fadeAt = window.setTimeout(() => setLeaving(true), 4300);
    const removeAt = window.setTimeout(() => dismissToast(toast.id), 5000);
    return () => {
      window.clearTimeout(fadeAt);
      window.clearTimeout(removeAt);
    };
  }, [toast, dismissToast]);

  if (!toast) return null;

  return (
    <div className="pointer-events-none flex justify-center">
      <div
        className={[
          "glass-strong flex items-center gap-3 rounded-2xl px-4 py-2.5",
          leaving ? "animate-toast-out" : "animate-toast-in",
        ].join(" ")}
      >
        <Sparkles size={16} strokeWidth={1.6} className="shrink-0 text-white/80" />
        <div className="leading-tight">
          <p className="font-serif text-[15px] tracking-wide text-white/90">{toast.title}</p>
          {toast.subtitle ? (
            <p className="text-[11px] tracking-wide text-white/55">{toast.subtitle}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
