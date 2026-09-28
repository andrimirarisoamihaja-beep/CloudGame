"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, Cloud, Loader2, Sparkles, Trash2, X } from "lucide-react";
import ReactionBar from "./ReactionBar";
import { storeHandoff } from "@/lib/handoff";
import type { CloudData } from "@/lib/types";
import type { WeatherSnapshot } from "@/lib/weather";

export interface SkyCardData {
  id: number;
  name: string;
  screenshotUrl: string | null;
  cloudState: CloudData[];
  weatherState: WeatherSnapshot;
  timeOfDay: number;
  createdAt: string;
  reactions: Record<string, number>;
}

/** Deterministic on server and client, so hydration never disagrees. */
const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function clockLabel(timeOfDay: number): string {
  const minutes = Math.round(timeOfDay * 1440);
  const hours = Math.floor(minutes / 60) % 24;
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}`;
}

export default function SkyCard({ sky }: { sky: SkyCardData }) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const created = new Date(sky.createdAt);

  const load = () => {
    setLoading(true);
    storeHandoff({
      clouds: sky.cloudState,
      timeOfDay: sky.timeOfDay / 1440,
      weather: sky.weatherState,
    });
    router.push("/");
  };

  const remove = async () => {
    setDeleting(true);
    try {
      const response = await fetch(`/api/skies/${sky.id}`, { method: "DELETE" });
      if (response.ok) {
        setOpen(false);
        router.refresh();
      }
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group glass relative overflow-hidden rounded-3xl text-left transition-all duration-300 hover:-translate-y-0.5 hover:bg-white/20"
      >
        <div className="relative aspect-[16/10] w-full overflow-hidden bg-gradient-to-b from-[#2b3c63] via-[#5c7ba8] to-[#cfdcea]">
          {sky.screenshotUrl ? (
            // Saved skies are self-contained data URLs — no remote image host.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={sky.screenshotUrl}
              alt={sky.name}
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-white/40">
              <Cloud size={30} strokeWidth={1.4} />
            </div>
          )}
        </div>

        <div className="flex items-start justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate font-serif text-[15px] tracking-wide text-white/90">
              {sky.name}
            </p>
            <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-white/45">
              <Clock size={11} strokeWidth={1.6} />
              {dateFormatter.format(created)}
              <span className="text-white/25">·</span>
              {clockLabel(sky.timeOfDay / 1440)}
            </p>
          </div>
          <div className="shrink-0">
            <ReactionBar skyId={sky.id} counts={sky.reactions} />
          </div>
        </div>
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#070b18]/70 p-4 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="glass-strong w-full max-w-3xl overflow-hidden rounded-3xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="relative aspect-[16/9] w-full overflow-hidden bg-[#0d1428]">
              {sky.screenshotUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={sky.screenshotUrl} alt={sky.name} className="h-full w-full object-cover" />
              ) : null}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                title="Close"
                className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/30 text-white/80 backdrop-blur transition hover:bg-black/45 hover:text-white"
              >
                <X size={17} strokeWidth={1.8} />
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
              <div>
                <p className="font-serif text-lg tracking-wide text-white/90">{sky.name}</p>
                <p className="mt-0.5 text-[11px] uppercase tracking-[0.18em] text-white/40">
                  {dateFormatter.format(created)} · {clockLabel(sky.timeOfDay / 1440)} ·{" "}
                  {sky.cloudState.length} {sky.cloudState.length === 1 ? "cloud" : "clouds"}
                </p>
              </div>

              <ReactionBar skyId={sky.id} counts={sky.reactions} size="md" />
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-white/10 px-5 py-4">
              <button
                type="button"
                onClick={remove}
                disabled={deleting}
                title="Delete this sky"
                aria-label="Delete this sky"
                className="flex items-center gap-2 rounded-2xl px-3 py-2 text-[13px] text-white/45 transition hover:bg-white/10 hover:text-white/80"
              >
                {deleting ? (
                  <Loader2 size={15} strokeWidth={1.7} className="animate-spin" />
                ) : (
                  <Trash2 size={15} strokeWidth={1.7} />
                )}
                Delete
              </button>

              <button
                type="button"
                onClick={load}
                disabled={loading}
                title="Open this sky and keep sculpting it"
                className="flex items-center gap-2 rounded-2xl bg-white/25 px-4 py-2 text-[13px] text-white transition hover:bg-white/35"
              >
                {loading ? (
                  <Loader2 size={15} strokeWidth={1.7} className="animate-spin" />
                ) : (
                  <Sparkles size={15} strokeWidth={1.7} />
                )}
                Load this sky
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
