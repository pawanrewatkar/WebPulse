import { NextResponse } from "next/server";
import { startCompare } from "@core/services";
import { handler, parseId, readJson, type Ctx } from "@/lib/api";

export const dynamic = "force-dynamic";

export const POST = handler(async (req: Request, ctx: Ctx<{ id: string }>) => {
  const id = parseId((await ctx.params).id);
  const body = await readJson(req).catch(() => ({}));
  const baselineRunId = body.baselineRunId ? Number(body.baselineRunId) : undefined;
  const job = await startCompare(id, baselineRunId);
  return NextResponse.json({ job }, { status: 202 });
});
