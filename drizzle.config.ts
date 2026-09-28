import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit config.
 *
 * Runtime migrations do not depend on this file: `GET /api/db/migrate` (and every
 * other API route, lazily) issues idempotent `CREATE TABLE IF NOT EXISTS`
 * statements through the Neon serverless driver, so a deploy needs nothing more
 * than `DATABASE_URL`.
 *
 * This config exists so `npx drizzle-kit studio` / `npx drizzle-kit generate`
 * work locally if you prefer generated SQL migrations.
 */
export default defineConfig({
  schema: "./lib/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
