import { NextResponse } from "next/server";
import { startBaseline } from "@core/services";
import { handler, parseId, readJson, type Ctx } from "@/lib/api";

export const dynamic = "force-dynamic";

/** "Save Website": queue creation of a new baseline version. */
export const POST = handler(async (req: Request, ctx: Ctx<{ id: string }>) => {
  const id = parseId((await ctx.params).id);
  const body = await readJson(req).catch(() => ({}));
  const job = await startBaseline(id, {
    label: typeof body.label === "string" ? body.label : undefined,
    setActive: body.setActive !== false,
    confirmNewVersion: body.confirmNewVersion === true,
  });
  return NextResponse.json({ job }, { status: 202 });
});
