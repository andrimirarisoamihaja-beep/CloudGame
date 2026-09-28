import { pgTable, serial, text, timestamp, integer, jsonb, index } from "drizzle-orm/pg-core";
import type { CloudData } from "@/lib/types";
import type { WeatherSnapshot } from "@/lib/weather";

/**
 * A saved sky: a screenshot plus everything needed to restore the exact scene.
 */
export const skies = pgTable(
  "skies",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull().default("Untitled Sky"),
    screenshotUrl: text("screenshot_url"),
    cloudState: jsonb("cloud_state").$type<CloudData[]>().notNull(),
    weatherState: jsonb("weather_state").$type<WeatherSnapshot>().notNull(),
    timeOfDay: integer("time_of_day").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("skies_created_at_idx").on(table.createdAt)],
);

/**
 * A reaction to a saved sky. `icon` is a lucide icon name from REACTION_ICONS.
 */
export const reactions = pgTable(
  "reactions",
  {
    id: serial("id").primaryKey(),
    skyId: integer("sky_id")
      .notNull()
      .references(() => skies.id, { onDelete: "cascade" }),
    icon: text("icon").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("reactions_sky_id_idx").on(table.skyId)],
);

export type SkyRow = typeof skies.$inferSelect;
export type NewSkyRow = typeof skies.$inferInsert;
export type ReactionRow = typeof reactions.$inferSelect;
export type NewReactionRow = typeof reactions.$inferInsert;
