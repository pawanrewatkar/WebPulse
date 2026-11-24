import { NextResponse } from "next/server";
import { getRepo } from "@core/db";
import { handler, parseId, type Ctx } from "@/lib/api";

export const dynamic = "force-dynamic";

export const POST = handler(async (_req: Request, ctx: Ctx<{ id: string }>) => {
  const id = parseId((await ctx.params).id);
  await getRepo().requestJobCancel(id);
  return NextResponse.json({ ok: true });
});
