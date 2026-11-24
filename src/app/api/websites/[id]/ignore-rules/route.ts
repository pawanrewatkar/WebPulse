import { NextResponse } from "next/server";
import { getRepo } from "@core/db";
import { handler, parseId, type Ctx } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = handler(async (_req: Request, ctx: Ctx<{ id: string }>) => {
  const id = parseId((await ctx.params).id);
  return NextResponse.json({ rules: await getRepo().listIgnoreRules(id) });
});

export const DELETE = handler(async (req: Request, ctx: Ctx<{ id: string }>) => {
  const websiteId = parseId((await ctx.params).id);
  const ruleId = parseId(new URL(req.url).searchParams.get("ruleId") ?? undefined);
  const rules = await getRepo().listIgnoreRules(websiteId);
  if (rules.some((r) => r.id === ruleId)) await getRepo().deleteIgnoreRule(ruleId);
  return NextResponse.json({ ok: true });
});
