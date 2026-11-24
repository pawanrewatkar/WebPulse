import { NextResponse } from "next/server";
import { startCapture } from "@core/services";
import { handler, parseId, readJson, type Ctx } from "@/lib/api";

export const dynamic = "force-dynamic";

export const POST = handler(async (req: Request, ctx: Ctx<{ id: string }>) => {
  const id = parseId((await ctx.params).id);
  const body = await readJson(req);
  const urls = Array.isArray(body.urls) ? body.urls.map(String) : [];
  const devices = Array.isArray(body.devices) ? body.devices.filter((d: string) => d === "desktop" || d === "mobile") : undefined;
  const job = await startCapture(id, urls, devices?.length ? devices : undefined);
  return NextResponse.json({ job }, { status: 202 });
});
