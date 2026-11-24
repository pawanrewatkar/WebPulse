import { NextResponse } from "next/server";
import { getRepo } from "@core/db";
import { ServiceError } from "@core/services";
import { handler, parseId, type Ctx } from "@/lib/api";
import type { ChangeCategory, Device, ReviewStatus, Severity } from "@core/types";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request, ctx: Ctx<{ id: string }>) => {
  const id = parseId((await ctx.params).id);
  const sp = new URL(req.url).searchParams;
  const repo = getRepo();
  const cmp = await repo.getComparison(id);
  if (!cmp) throw new ServiceError("Comparison not found", 404);
  const changes = await repo.listChanges(id, {
    device: (sp.get("device") as Device) || undefined,
    category: (sp.get("category") as ChangeCategory) || undefined,
    severity: (sp.get("severity") as Severity) || undefined,
    reviewStatus: (sp.get("review") as ReviewStatus) || undefined,
    urlKey: sp.get("url") || undefined,
    includeIgnored: sp.get("includeIgnored") === "1",
  });
  return NextResponse.json({ comparison: cmp, changes });
});
