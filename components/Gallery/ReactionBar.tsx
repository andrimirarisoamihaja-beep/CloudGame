"use client";

import { useState, useTransition } from "react";
import { Cloud, Heart, Rainbow, Star, Sun } from "lucide-react";
import { REACTION_ICONS, REACTION_LABELS, type ReactionIcon } from "@/lib/reactions";

const ICONS: Record<ReactionIcon, typeof Sun> = {
  sun: Sun,
  heart: Heart,
  cloud: Cloud,
  rainbow: Rainbow,
  star: Star,
};

interface ReactionBarProps {
  skyId: number;
  counts: Record<string, number>;
  size?: "sm" | "md";
}

/**
 * Five lucide icons, no emoji. Clicking one posts to
 * `POST /api/skies/[id]/react` and the count updates optimistically.
 */
export default function ReactionBar({ skyId, counts, size = "sm" }: ReactionBarProps) {
  const [optimistic, setOptimistic] = useState<Record<string, number>>(() => ({ ...counts }));
  const [mine, setMine] = useState<Record<string, number>>(() => ({}));
  const [, startTransition] = useTransition();

  const react = (icon: ReactionIcon) => {
    setOptimistic((current) => ({ ...current, [icon]: (current[icon] ?? 0) + 1 }));
    setMine((current) => ({ ...current, [icon]: (current[icon] ?? 0) + 1 }));
    startTransition(async () => {
      try {
        const response = await fetch(`/api/skies/${skyId}/react`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ icon }),
        });
        if (!response.ok) return;
        const data = (await response.json()) as { reactions?: Record<string, number> };
        if (data.reactions) setOptimistic(data.reactions);
      } catch {
        // A failed reaction is silently ignored: nothing about a saved sky
        // should ever feel like an error state.
      }
    });
  };

  const iconSize = size === "sm" ? 14 : 17;

  return (
    <div className="flex items-center gap-1">
      {REACTION_ICONS.map((icon) => {
        const Icon = ICONS[icon];
        const count = optimistic[icon] ?? 0;
        const touched = (mine[icon] ?? 0) > 0;
        return (
          <button
            key={icon}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              react(icon);
            }}
            title={REACTION_LABELS[icon]}
            aria-label={`React with ${REACTION_LABELS[icon]}`}
            className={[
              "flex items-center gap-1 rounded-full px-2 py-1 transition-all duration-200",
              touched
                ? "bg-white/25 text-white"
                : "text-white/55 hover:bg-white/15 hover:text-white/90",
            ].join(" ")}
          >
            <Icon size={iconSize} strokeWidth={1.7} />
            {count > 0 ? (
              <span className="text-[11px] tabular-nums text-white/70">{count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
