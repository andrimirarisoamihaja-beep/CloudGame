import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { ensureSchema, getDatabase, isDatabaseConfigured } from "@/lib/db";
import { reactions, skies } from "@/lib/schema";
import { REACTION_ICONS } from "@/lib/reactions";
import { sanitizeClouds, type CloudData } from "@/lib/types";
import { WEATHER_STATES, type WeatherName, type WeatherSnapshot } from "@/lib/weather";
import { clamp01 } from "@/lib/utils";

/**
 * Persistence for saved skies.
 *
 * Two backends, one interface:
 *  - `database` — Neon PostgreSQL through Drizzle (the real path).
 *  - `memory`   — a process-local list used when `DATABASE_URL` is absent, so a
 *                 fresh clone (or a preview deployment) still has a working
 *                 gallery instead of a wall of errors. It is not durable and the
 *                 API says so in every response.
 */

export type StorageMode = "database" | "memory";

export interface SkyRecord {
  id: number;
  name: string;
  screenshotUrl: string | null;
  cloudState: CloudData[];
  weatherState: WeatherSnapshot;
  timeOfDay: number;
  createdAt: string;
  reactions: Record<string, number>;
}

export interface ListResult {
  skies: SkyRecord[];
  mode: StorageMode;
}

export interface NewSkyInput {
  name: string;
  screenshotUrl: string | null;
  cloudState: CloudData[];
  weatherState: WeatherSnapshot;
  timeOfDay: number;
}

/** ---------------------------------------------------------------------------
 * In-memory fallback
 * ------------------------------------------------------------------------- */

interface MemoryRow extends NewSkyInput {
  id: number;
  createdAt: string;
  reactions: Record<string, number>;
}

interface MemoryStore {
  rows: MemoryRow[];
  nextId: number;
}

/**
 * The fallback lives in a temp file (mirrored on `globalThis` for speed).
 *
 * Why a file: Next compiles each route and each server component into its own
 * module graph, and dev/preview run them in separate worker processes, so a
 * plain module-level array would give the gallery page and the API routes
 * different, empty galleries. A tiny JSON file keeps one deployment internally
 * consistent. It is still *not durable* — only `DATABASE_URL` is. On Vercel the
 * file is per-instance and ephemeral; the gallery says so out loud.
 */
const FALLBACK_PATH = join(tmpdir(), "cloud-sculptor-skies.json");
const globalMemory = globalThis as typeof globalThis & {
  __cloudSculptorMemory?: MemoryStore;
};

function emptyStore(): MemoryStore {
  return { rows: [], nextId: 1 };
}

function readStore(): MemoryStore {
  const cached = globalMemory.__cloudSculptorMemory;
  if (cached) return cached;
  let store = emptyStore();
  try {
    const parsed = JSON.parse(readFileSync(FALLBACK_PATH, "utf8")) as MemoryStore;
    if (parsed && Array.isArray(parsed.rows)) store = parsed;
  } catch {
    // No file yet (or an unwritable sandbox): start empty.
  }
  globalMemory.__cloudSculptorMemory = store;
  return store;
}

function writeStore(store: MemoryStore): void {
  globalMemory.__cloudSculptorMemory = store;
  try {
    writeFileSync(FALLBACK_PATH, JSON.stringify(store));
  } catch {
    // Read-only filesystem: the in-process copy still works for this instance.
  }
}

function memoryToList(limit: number): SkyRecord[] {
  return readStore()
    .rows.slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit)
    .map((row) => ({ ...row }));
}

/** ---------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------- */

function emptyReactions(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const icon of REACTION_ICONS) counts[icon] = 0;
  return counts;
}

function normalizeWeather(input: unknown): WeatherSnapshot {
  const raw = (input ?? {}) as Partial<WeatherSnapshot>;
  const state: WeatherName = WEATHER_STATES.includes(raw.state as WeatherName)
    ? (raw.state as WeatherName)
    : "CLEAR";
  const direction = Array.isArray(raw.windDirection)
    ? [
        Number(raw.windDirection[0]) || 0,
        Number(raw.windDirection[1]) || 0,
        Number(raw.windDirection[2]) || 0,
      ]
    : [1, 0, 0];
  return {
    state,
    humidity: clamp01(Number(raw.humidity) || 0),
    windStrength: clamp01(Number(raw.windStrength) || 0),
    windDirection: direction as [number, number, number],
    rainIntensity: clamp01(Number(raw.rainIntensity) || 0),
    overcast: clamp01(Number(raw.overcast) || 0),
    isRaining: Boolean(raw.isRaining),
  };
}

/** ---------------------------------------------------------------------------
 * Reads
 * ------------------------------------------------------------------------- */

export async function listSkies(limit = 50): Promise<ListResult> {
  const db = getDatabase();
  if (!db) return { skies: memoryToList(limit), mode: "memory" };
  await ensureSchema();

  const rows = await db
    .select()
    .from(skies)
    .orderBy(desc(skies.createdAt))
    .limit(Math.min(Math.max(limit, 1), 50));

  const counts = await reactionCounts(rows.map((row) => row.id));
  return {
    mode: "database",
    skies: rows.map((row) => ({
      id: row.id,
      name: row.name,
      screenshotUrl: row.screenshotUrl,
      cloudState: sanitizeClouds(row.cloudState),
      weatherState: normalizeWeather(row.weatherState),
      timeOfDay: row.timeOfDay,
      createdAt: row.createdAt.toISOString(),
      reactions: counts[row.id] ?? emptyReactions(),
    })),
  };
}

export async function getSky(id: number): Promise<{ sky: SkyRecord | null; mode: StorageMode }> {
  const db = getDatabase();
  if (!db) {
    const row = readStore().rows.find((entry) => entry.id === id);
    return { sky: row ? { ...row } : null, mode: "memory" };
  }
  await ensureSchema();

  const rows = await db.select().from(skies).where(eq(skies.id, id)).limit(1);
  const row = rows[0];
  if (!row) return { sky: null, mode: "database" };
  const counts = await reactionCounts([row.id]);
  return {
    mode: "database",
    sky: {
      id: row.id,
      name: row.name,
      screenshotUrl: row.screenshotUrl,
      cloudState: sanitizeClouds(row.cloudState),
      weatherState: normalizeWeather(row.weatherState),
      timeOfDay: row.timeOfDay,
      createdAt: row.createdAt.toISOString(),
      reactions: counts[row.id] ?? emptyReactions(),
    },
  };
}

async function reactionCounts(ids: number[]): Promise<Record<number, Record<string, number>>> {
  const result: Record<number, Record<string, number>> = {};
  for (const id of ids) result[id] = emptyReactions();
  if (ids.length === 0) return result;

  const db = getDatabase();
  if (!db) {
    const store = readStore();
    for (const id of ids) {
      const row = store.rows.find((entry) => entry.id === id);
      if (row) result[id] = { ...emptyReactions(), ...row.reactions };
    }
    return result;
  }

  const rows = await db
    .select({
      skyId: reactions.skyId,
      icon: reactions.icon,
      count: sql<number>`count(*)::int`,
    })
    .from(reactions)
    .where(inArray(reactions.skyId, ids))
    .groupBy(reactions.skyId, reactions.icon);

  for (const row of rows) {
    if (!result[row.skyId]) result[row.skyId] = emptyReactions();
    if (row.icon in result[row.skyId]) result[row.skyId][row.icon] = Number(row.count);
  }
  return result;
}

/** ---------------------------------------------------------------------------
 * Writes
 * ------------------------------------------------------------------------- */

export async function createSky(
  input: NewSkyInput,
): Promise<{ id: number; mode: StorageMode }> {
  const db = getDatabase();

  if (!db) {
    const store = readStore();
    const id = store.nextId;
    store.nextId += 1;
    store.rows.push({
      id,
      name: input.name,
      screenshotUrl: input.screenshotUrl,
      cloudState: input.cloudState,
      weatherState: input.weatherState,
      timeOfDay: input.timeOfDay,
      createdAt: new Date().toISOString(),
      reactions: emptyReactions(),
    });
    // Keep the preview sandbox from growing without bound.
    if (store.rows.length > 60) store.rows.splice(0, store.rows.length - 60);
    writeStore(store);
    return { id, mode: "memory" };
  }

  await ensureSchema();
  const rows = await db
    .insert(skies)
    .values({
      name: input.name,
      screenshotUrl: input.screenshotUrl,
      cloudState: input.cloudState,
      weatherState: input.weatherState,
      timeOfDay: input.timeOfDay,
    })
    .returning({ id: skies.id });

  return { id: rows[0].id, mode: "database" };
}

export async function deleteSky(id: number): Promise<{ deleted: boolean; mode: StorageMode }> {
  const db = getDatabase();
  if (!db) {
    const store = readStore();
    const index = store.rows.findIndex((entry) => entry.id === id);
    if (index >= 0) {
      store.rows.splice(index, 1);
      writeStore(store);
    }
    return { deleted: index >= 0, mode: "memory" };
  }
  await ensureSchema();
  // Reactions cascade (ON DELETE CASCADE on reactions.sky_id).
  const rows = await db.delete(skies).where(eq(skies.id, id)).returning({ id: skies.id });
  return { deleted: rows.length > 0, mode: "database" };
}

export async function addReaction(
  skyId: number,
  icon: string,
): Promise<{ ok: boolean; mode: StorageMode; reactions: Record<string, number> }> {
  const db = getDatabase();

  if (!db) {
    const store = readStore();
    const row = store.rows.find((entry) => entry.id === skyId);
    if (!row) return { ok: false, mode: "memory", reactions: emptyReactions() };
    row.reactions[icon] = (row.reactions[icon] ?? 0) + 1;
    writeStore(store);
    return { ok: true, mode: "memory", reactions: { ...emptyReactions(), ...row.reactions } };
  }

  await ensureSchema();
  const exists = await db
    .select({ id: skies.id })
    .from(skies)
    .where(eq(skies.id, skyId))
    .limit(1);
  if (exists.length === 0) return { ok: false, mode: "database", reactions: emptyReactions() };

  await db.insert(reactions).values({ skyId, icon });
  const counts = await reactionCounts([skyId]);
  return { ok: true, mode: "database", reactions: counts[skyId] ?? emptyReactions() };
}

/** Used by the gallery empty-state and the migrate endpoint's health report. */
export function storageMode(): StorageMode {
  return isDatabaseConfigured() ? "database" : "memory";
}

/** Sanity check for `/api/db/migrate`. */
export async function pingDatabase(): Promise<{ ok: boolean; error?: string }> {
  const db = getDatabase();
  if (!db) return { ok: false, error: "DATABASE_URL is not set" };
  try {
    await db.execute(sql`select 1`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Exported for completeness/testing of the cascade path. */
export async function deleteReactionsFor(skyId: number): Promise<void> {
  const db = getDatabase();
  if (!db) return;
  await db.delete(reactions).where(and(eq(reactions.skyId, skyId)));
}
