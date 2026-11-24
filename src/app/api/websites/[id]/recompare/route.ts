import { NextResponse } from "next/server";
import { startRecompare } from "@core/services";
import { handler, parseId, readJson, type Ctx } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Compare two existing runs (e.g. any historical baseline vs a later capture) without crawling. */
export const POST = handler(async (req: Request, ctx: Ctx<{ id: string }>) => {
  const id = parseId((await ctx.params).id);
  const body = await readJson(req);
  const job = await startRecompare(id, parseId(String(body.baselineRunId)), parseId(String(body.currentRunId)));
  return NextResponse.json({ job }, { status: 202 });
});
