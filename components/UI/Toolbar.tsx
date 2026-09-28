"use client";

import { Eraser, Minus, Move, Plus } from "lucide-react";
import { useGameStore, type ToolId } from "@/lib/store";

const TOOLS: Array<{ id: ToolId; label: string; hint: string; Icon: typeof Plus }> = [
  { id: "puff", label: "Puff", hint: "Click and hold to inflate a cloud — drag to pull its shape", Icon: Plus },
  { id: "shape", label: "Shape", hint: "Grab a cloud near its middle to move it, or its edges to stretch", Icon: Move },
  { id: "carve", label: "Carve", hint: "Click and hold to carve a cloud back down", Icon: Minus },
  { id: "erase", label: "Dissipate", hint: "Click and hold to let a cloud dissolve into the sky", Icon: Eraser },
];

/** Bottom-centre tool selector. Icons only; the meaning appears on hover. */
export default function Toolbar() {
  const tool = useGameStore((state) => state.tool);
  const setTool = useGameStore((state) => state.setTool);

  return (
    <div className="glass pointer-events-auto flex items-center gap-1 rounded-2xl p-1.5">
      {TOOLS.map(({ id, label, hint, Icon }) => {
        const active = tool === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => setTool(id)}
            title={hint}
            aria-label={label}
            aria-pressed={active}
            className={[
              "flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-200",
              active
                ? "bg-white/30 text-white shadow-sm"
                : "text-white/60 hover:bg-white/15 hover:text-white/90",
            ].join(" ")}
          >
            <Icon size={18} strokeWidth={1.7} />
          </button>
        );
      })}
    </div>
  );
}
