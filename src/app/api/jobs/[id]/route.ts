import { NextResponse } from "next/server";
import { getRepo } from "@core/db";
import { ServiceError } from "@core/services";
import { handler, parseId, type Ctx } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request, ctx: Ctx<{ id: string }>) => {
  const id = parseId((await ctx.params).id);
  const after = Number(new URL(req.url).searchParams.get("after")) || 0;
  const repo = getRepo();
  const job = await repo.getJob(id);
  if (!job) throw new ServiceError("Job not found", 404);
  return NextResponse.json({ job, logs: await repo.listJobLogs(id, after) });
});
