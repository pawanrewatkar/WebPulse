import { getRepo } from "../db";
import { errorMessage } from "../logger";
import { createJobContext, JobCancelledError } from "./context";
import { runJob } from "./handlers";
import type { Job } from "../types";

/** Runs a claimed (status=running) job to completion and records the outcome. Never throws. */
export async function executeJob(job: Job): Promise<{ ok: boolean; result?: Record<string, unknown>; error?: string }> {
  const repo = getRepo();
  const ctx = createJobContext(job);
  const started = Date.now();
  ctx.log.info(`Running ${job.type} job`, { websiteId: job.websiteId });
  const beat = setInterval(() => void repo.heartbeatJob(job.id).catch(() => {}), 5000);
  try {
    const result = await runJob(ctx);
    await repo.updateJob(job.id, {
      status: "completed",
      progress: 1,
      result,
      finishedAt: new Date().toISOString(),
      message: typeof result.message === "string" ? result.message : "Completed",
    });
    ctx.log.info(`Job completed in ${Math.round((Date.now() - started) / 1000)}s`);
    return { ok: true, result };
  } catch (e) {
    const cancelled = e instanceof JobCancelledError;
    const msg = errorMessage(e);
    ctx.log.error(cancelled ? "Job cancelled" : `Job failed: ${msg}`);
    await repo.updateJob(job.id, {
      status: cancelled ? "cancelled" : "failed",
      error: cancelled ? null : msg,
      message: cancelled ? "Cancelled" : "Failed",
      finishedAt: new Date().toISOString(),
    });
    return { ok: false, error: msg };
  } finally {
    clearInterval(beat);
  }
}
