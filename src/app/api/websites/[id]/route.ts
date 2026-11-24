import { NextResponse } from "next/server";
import { getRepo } from "@core/db";
import { ServiceError, updateWebsite } from "@core/services";
import { handler, parseId, readJson, type Ctx } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = handler(async (_req: Request, ctx: Ctx<{ id: string }>) => {
  const id = parseId((await ctx.params).id);
  const repo = getRepo();
  const website = await repo.getWebsite(id);
  if (!website) throw new ServiceError("Website not found", 404);
  const [runs, comparisons] = await Promise.all([repo.listRuns(id), repo.listComparisons(id)]);
  return NextResponse.json({ website, runs, comparisons });
});

export const PATCH = handler(async (req: Request, ctx: Ctx<{ id: string }>) => {
  const id = parseId((await ctx.params).id);
  const website = await updateWebsite(id, await readJson(req));
  return NextResponse.json({ website });
});
