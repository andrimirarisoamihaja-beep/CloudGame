import { NextResponse } from "next/server";
import { z } from "zod";
import { WEATHER_STATES } from "@/lib/weather";
import { MAX_BLOBS, MAX_CLOUDS } from "@/lib/types";
import { uid } from "@/lib/utils";
import { createSky, listSkies } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const blobSchema = z.object({
  position: z.tuple([z.number(), z.number(), z.number()]),
  radius: z.number().min(0.2).max(12),
});

const cloudSchema = z
  .object({
    id: z.string().max(64).optional(),
    blobs: z.array(blobSchema).min(1).max(MAX_BLOBS),
    density: z.number().min(0).max(1),
    position: z.tuple([z.number(), z.number(), z.number()]),
  })
  // A cloud without an id still gets one, so a loaded sky is always addressable.
  .transform((cloud) => ({ ...cloud, id: cloud.id ?? uid("cloud") }));

const weatherSchema = z.object({
  state: z.enum(WEATHER_STATES),
  humidity: z.number().min(0).max(1),
  windStrength: z.number().min(0).max(1),
  windDirection: z.tuple([z.number(), z.number(), z.number()]),
  rainIntensity: z.number().min(0).max(1),
  overcast: z.number().min(0).max(1),
  isRaining: z.boolean(),
});

/**
 * A saved sky is one screenshot (a self-contained data URL — no blob storage,
 * no external host) plus the exact cloud and weather state that produced it.
 */
const createSkySchema = z.object({
  name: z.string().trim().min(1).max(80).default("Untitled Sky"),
  screenshotUrl: z
    .string()
    .refine((value) => value.startsWith("data:image/"), {
      message: "screenshotUrl must be an image data URL",
    })
    .max(6_000_000)
    .nullable()
    .optional(),
  cloudState: z.array(cloudSchema).min(0).max(MAX_CLOUDS),
  weatherState: weatherSchema,
  timeOfDay: z.number().int().min(0).max(1440),
});

/** GET /api/skies — newest skies first (max 50). */
export async function GET(request: Request) {
  const limit = z.coerce.number().int().min(1).max(50).catch(50).parse(
    new URL(request.url).searchParams.get("limit") ?? 50,
  );

  try {
    const { skies, mode } = await listSkies(limit);
    return NextResponse.json({ skies, mode, count: skies.length });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list skies" },
      { status: 500 },
    );
  }
}

/** POST /api/skies — save the sky the player is looking at. */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createSkySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid sky payload", issues: z.treeifyError(parsed.error) },
      { status: 400 },
    );
  }

  try {
    const { id, mode } = await createSky({
      name: parsed.data.name,
      screenshotUrl: parsed.data.screenshotUrl ?? null,
      cloudState: parsed.data.cloudState,
      weatherState: parsed.data.weatherState,
      timeOfDay: parsed.data.timeOfDay,
    });
    return NextResponse.json({ id, mode }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save sky";
    const missingDatabase = !process.env.DATABASE_URL;
    return NextResponse.json({ error: message, hint: missingDatabase ? "Set DATABASE_URL" : undefined }, {
      status: missingDatabase ? 503 : 500,
    });
  }
}
