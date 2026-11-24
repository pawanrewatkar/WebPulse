import { NextResponse } from "next/server";
import { getRepo } from "@core/db";
import { ServiceError } from "@core/services";
import { handler, parseId, readJson, type Ctx } from "@/lib/api";

export const dynamic = "force-dynamic";

const STATUSES = ["pending", "confirmed", "ignored", "flagged"] as const;

/** Review a detected change: confirm, ignore (optionally always), flag, or reset to pending. */
export const PATCH = handler(async (req: Request, ctx: Ctx<{ id: string }>) => {
  const id = parseId((await ctx.params).id);
  const body = await readJson(req);
  if (!STATUSES.includes(body.reviewStatus)) throw new ServiceError("reviewStatus must be one of " + STATUSES.join(", "));
  const note = typeof body.note === "string" ? body.note.slice(0, 2000) : null;
  const repo = getRepo();
  const existing = await repo.getChange(id);
  if (!existing) throw new ServiceError("Change not found", 404);
  const change = await repo.reviewChange(id, body.reviewStatus, note);
  if (body.alwaysIgnore === true && body.reviewStatus === "ignored") {
    const cmp = await repo.getComparison(existing.comparisonId);
    if (cmp) await repo.addIgnoreRule(cmp.websiteId, existing.fingerprint, `${existing.category}: ${existing.description} (${existing.url}, ${existing.device})`.slice(0, 500));
  }
  return NextResponse.json({ change });
});
