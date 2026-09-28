import { NextResponse } from "next/server";
import { ensureSchema, isDatabaseConfigured } from "@/lib/db";
import { pingDatabase, storageMode } from "@/lib/repository";
import { skies, reactions } from "@/lib/schema";
import { sql } from "drizzle-orm";
import { getDatabase } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/db/migrate — creates the two tables if they do not exist yet.
 *
 * Idempotent: safe to call on every deploy. Every other route also calls
 * `ensureSchema()` lazily, so hitting this endpoint is a convenience rather than
 * a requirement — but it is the quickest way to confirm a fresh Neon database is
 * wired up correctly.
 */
export async function GET() {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        mode: "memory",
        error: "DATABASE_URL is not set",
        hint: "Add DATABASE_URL to your environment (see .env.example), then call this route again.",
      },
      { status: 503 },
    );
  }

  try {
    await ensureSchema();
    const database = getDatabase();
    const [skyCount] = await database!.select({ count: sql<number>`count(*)::int` }).from(skies);
    const [reactionCount] = await database!
      .select({ count: sql<number>`count(*)::int` })
      .from(reactions);

    const health = await pingDatabase();
    return NextResponse.json({
      ok: health.ok,
      mode: storageMode(),
      tables: { skies: "skies", reactions: "reactions" },
      rows: { skies: Number(skyCount?.count ?? 0), reactions: Number(reactionCount?.count ?? 0) },
      message: "Schema is up to date",
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Migration failed",
      },
      { status: 500 },
    );
  }
}
