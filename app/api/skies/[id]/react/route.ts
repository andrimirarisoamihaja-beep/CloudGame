import { NextResponse } from "next/server";
import { z } from "zod";
import { isReactionIcon } from "@/lib/reactions";
import { addReaction } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const idSchema = z.coerce.number().int().positive();

/** The icon is validated against the lucide allowlist, never trusted raw. */
const bodySchema = z.object({
  icon: z.string().refine(isReactionIcon, { message: "Unknown reaction icon" }),
});

type Context = { params: Promise<{ id: string }> };

/** POST /api/skies/[id]/react — add one reaction and return the new counts. */
export async function POST(request: Request, context: Context) {
  const id = idSchema.safeParse((await context.params).id);
  if (!id.success) return NextResponse.json({ error: "Invalid sky id" }, { status: 400 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid reaction", issues: z.treeifyError(parsed.error) },
      { status: 400 },
    );
  }

  try {
    const result = await addReaction(id.data, parsed.data.icon);
    if (!result.ok) return NextResponse.json({ error: "Sky not found" }, { status: 404 });
    return NextResponse.json({ ok: true, reactions: result.reactions, mode: result.mode });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to add reaction" },
      { status: 500 },
    );
  }
}
