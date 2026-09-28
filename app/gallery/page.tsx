import Link from "next/link";
import { ArrowLeft, Cloud, Database, HardDrive } from "lucide-react";
import SkyCard from "@/components/Gallery/SkyCard";
import { listSkies } from "@/lib/repository";

/**
 * The gallery is a server component: it reads Neon directly, so the first paint
 * already contains every saved sky (no client fetch, no spinner).
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Gallery · Cloud Sculptor",
};

export default async function GalleryPage() {
  const { skies, mode } = await listSkies(50).catch(() => ({ skies: [], mode: "memory" as const }));

  return (
    <main className="h-screen w-screen overflow-y-auto overscroll-contain bg-gradient-to-b from-[#131b36] via-[#33456d] to-[#8fa6c4]">
      <div className="mx-auto w-full max-w-6xl px-6 py-10">
        <header className="mb-9 flex flex-wrap items-end justify-between gap-4">
          <div>
            <Link
              href="/"
              className="mb-3 inline-flex items-center gap-2 text-[12px] uppercase tracking-[0.2em] text-white/50 transition hover:text-white/85"
            >
              <ArrowLeft size={14} strokeWidth={1.8} />
              Back to the sky
            </Link>
            <h1 className="font-serif text-4xl tracking-wide text-white/90">Gallery</h1>
            <p className="mt-1 text-[13px] text-white/50">
              {skies.length === 0
                ? "No skies saved yet."
                : `${skies.length} ${skies.length === 1 ? "sky" : "skies"} kept by everyone who passed through.`}
            </p>
          </div>

          <div className="glass flex items-center gap-2 rounded-2xl px-3 py-2 text-[11px] text-white/55">
            {mode === "database" ? (
              <Database size={14} strokeWidth={1.7} />
            ) : (
              <HardDrive size={14} strokeWidth={1.7} />
            )}
            {mode === "database"
              ? "Stored in Neon PostgreSQL"
              : "Preview storage — set DATABASE_URL to keep skies"}
          </div>
        </header>

        {skies.length === 0 ? (
          <div className="glass flex flex-col items-center gap-4 rounded-3xl px-6 py-20 text-center">
            <Cloud size={40} strokeWidth={1.2} className="text-white/45" />
            <div>
              <p className="font-serif text-xl text-white/85">The gallery is still empty</p>
              <p className="mt-1 text-[13px] text-white/50">
                Sculpt a sky, then press the camera icon to keep it here.
              </p>
            </div>
            <Link
              href="/"
              className="mt-2 rounded-2xl bg-white/20 px-5 py-2.5 text-[13px] text-white transition hover:bg-white/30"
            >
              Go sculpt
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {skies.map((sky) => (
              <SkyCard key={sky.id} sky={sky} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
