import { NextResponse } from "next/server";
import { getRepo } from "@core/db";
import { handler } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  const sp = new URL(req.url).searchParams;
  const websiteId = sp.get("websiteId") ? Number(sp.get("websiteId")) : undefined;
  const active = sp.get("active") === "1";
  const jobs = await getRepo().listJobs({ websiteId, limit: Number(sp.get("limit")) || 50, status: active ? ["queued", "running"] : undefined });
  return NextResponse.json({ jobs });
});
