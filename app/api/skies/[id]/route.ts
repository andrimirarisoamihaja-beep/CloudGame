import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteSky, getSky } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const idSchema = z.coerce.number().int().positive();

type Context = { params: Promise<{ id: string }> };

/** GET /api/skies/[id] — one sky with its reaction counts. */
export async function GET(_request: Request, context: Context) {
  const parsed = idSchema.safeParse((await context.params).id);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid sky id" }, { status: 400 });
  }

  try {
    const { sky, mode } = await getSky(parsed.data);
    if (!sky) return NextResponse.json({ error: "Sky not found" }, { status: 404 });
    return NextResponse.json({ sky, mode });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load sky" },
      { status: 500 },
    );
  }
}

/** DELETE /api/skies/[id] — reactions cascade away with it. */
export async function DELETE(_request: Request, context: Context) {
  const parsed = idSchema.safeParse((await context.params).id);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid sky id" }, { status: 400 });
  }

  try {
    const { deleted, mode } = await deleteSky(parsed.data);
    if (!deleted) return NextResponse.json({ error: "Sky not found" }, { status: 404 });
    return NextResponse.json({ deleted: true, id: parsed.data, mode });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete sky" },
      { status: 500 },
    );
  }
}
