import { NextResponse } from "next/server";
import { restoreBaseline } from "@core/services";
import { handler, parseId, readJson, type Ctx } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Rollback: make a previous baseline version the active one. Nothing is deleted. */
export const POST = handler(async (req: Request, ctx: Ctx<{ id: string }>) => {
  const id = parseId((await ctx.params).id);
  const body = await readJson(req);
  await restoreBaseline(id, parseId(String(body.runId)));
  return NextResponse.json({ ok: true });
});
