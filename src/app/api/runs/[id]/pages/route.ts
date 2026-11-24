import { NextResponse } from "next/server";
import { getRepo } from "@core/db";
import { ServiceError } from "@core/services";
import { handler, parseId, type Ctx } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = handler(async (_req: Request, ctx: Ctx<{ id: string }>) => {
  const id = parseId((await ctx.params).id);
  const repo = getRepo();
  const run = await repo.getRun(id);
  if (!run) throw new ServiceError("Run not found", 404);
  return NextResponse.json({ run, pages: await repo.listPages(id) });
});
