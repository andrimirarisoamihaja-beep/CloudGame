import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { sql } from "drizzle-orm";
import * as schema from "@/lib/schema";

/**
 * Neon + Drizzle over the serverless HTTP driver.
 *
 * The HTTP driver is stateless per request, which is exactly what Vercel
 * functions want — no WebSocket, no connection pool to keep warm, no long-lived
 * process. `DATABASE_URL` is the single environment variable the whole app needs.
 */

export type Database = ReturnType<typeof drizzle<typeof schema>>;

interface Cache {
  url: string;
  db: Database;
}

let cache: Cache | null = null;
let schemaPromise: Promise<void> | null = null;

export function isDatabaseConfigured(): boolean {
  const url = process.env.DATABASE_URL;
  return typeof url === "string" && url.trim().length > 0;
}

export function getDatabase(): Database | null {
  if (!isDatabaseConfigured()) return null;
  const url = process.env.DATABASE_URL as string;
  if (cache && cache.url === url) return cache.db;
  const client = neon(url);
  const db = drizzle(client, { schema });
  cache = { url, db };
  return db;
}

/**
 * Idempotent schema bootstrap. Runs `CREATE TABLE IF NOT EXISTS` statements so a
 * brand-new Neon branch becomes usable the moment the first request lands —
 * no `drizzle-kit migrate` step in the deploy pipeline, and safe to run twice.
 *
 * The result is memoised per serverless instance; every repository call awaits
 * it, so `/api/db/migrate` is a convenience, not a requirement.
 */
export function ensureSchema(): Promise<void> {
  if (schemaPromise) return schemaPromise;
  const db = getDatabase();
  if (!db) {
    schemaPromise = Promise.resolve();
    return schemaPromise;
  }
  schemaPromise = (async () => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS skies (
        id serial PRIMARY KEY,
        name text NOT NULL DEFAULT 'Untitled Sky',
        screenshot_url text,
        cloud_state jsonb NOT NULL,
        weather_state jsonb NOT NULL,
        time_of_day integer NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS skies_created_at_idx ON skies (created_at DESC)`,
    );
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS reactions (
        id serial PRIMARY KEY,
        sky_id integer NOT NULL REFERENCES skies (id) ON DELETE CASCADE,
        icon text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS reactions_sky_id_idx ON reactions (sky_id)`);
  })().catch((error) => {
    // Allow a later request to retry instead of caching the failure forever.
    schemaPromise = null;
    throw error;
  });
  return schemaPromise;
}
