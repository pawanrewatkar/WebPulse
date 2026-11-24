import { NextResponse } from "next/server";
import { getRepo } from "@core/db";
import { createWebsite } from "@core/services";
import { handler, readJson } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = handler(async () => {
  return NextResponse.json({ websites: await getRepo().listWebsites() });
});

export const POST = handler(async (req: Request) => {
  const website = await createWebsite(await readJson(req));
  return NextResponse.json({ website }, { status: 201 });
});
