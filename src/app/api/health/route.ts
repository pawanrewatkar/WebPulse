import { NextResponse } from "next/server";
import { getRepo } from "@core/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const repo = getRepo();
  const [workers, running, queued] = await Promise.all([
    repo.listLiveWorkers(20_000),
    repo.listJobs({ status: ["running"], limit: 20 }),
    repo.listJobs({ status: ["queued"], limit: 100 }),
  ]);
  return NextResponse.json({ ok: true, workers, runningJobs: running.length, queuedJobs: queued.length });
}
