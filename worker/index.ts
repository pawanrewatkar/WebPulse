/**
 * Background worker: polls the jobs table, runs crawls/comparisons with Playwright, and records progress.
 * Runs independently of the web app:  npm run worker
 */
import crypto from "node:crypto";
import os from "node:os";
import { getConfig } from "../core/config";
import { closeRepo, getRepo } from "../core/db";
import { createLogger, errorMessage } from "../core/logger";
import { executeJob } from "../core/jobs/runner";

const log = createLogger("worker");
const workerId = `${os.hostname()}-${process.pid}-${crypto.randomBytes(3).toString("hex")}`;
let stopping = false;
let currentJobId: number | null = null;

async function main() {
  const cfg = getConfig();
  const repo = getRepo();
  log.info(`Worker ${workerId} started`, { dataDir: cfg.dataDir, pollMs: cfg.workerPollMs });

  // Jobs left "running" by a crashed worker would block their website forever: fail them clearly.
  const stale = await repo.failStaleJobs(60_000);
  if (stale.length) log.warn(`Marked ${stale.length} stale running job(s) as failed`, { ids: stale });

  const beat = setInterval(() => void repo.workerBeat(workerId, process.pid, currentJobId).catch(() => {}), 5000);
  await repo.workerBeat(workerId, process.pid, null);

  while (!stopping) {
    let job = null;
    try {
      job = await repo.claimNextJob();
    } catch (e) {
      log.error("Failed to claim job", { message: errorMessage(e) });
    }
    if (!job) {
      await sleep(cfg.workerPollMs);
      continue;
    }
    currentJobId = job.id;
    await repo.workerBeat(workerId, process.pid, job.id);
    log.info(`Picked up job #${job.id} (${job.type})`);
    const res = await executeJob(job);
    log.info(`Job #${job.id} ${res.ok ? "completed" : `ended: ${res.error ?? "cancelled"}`}`);
    currentJobId = null;
  }
  clearInterval(beat);
  await repo.workerStopped(workerId);
  closeRepo();
  log.info("Worker stopped");
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function shutdown(signal: string) {
  if (stopping) process.exit(1);
  stopping = true;
  log.info(`${signal} received – stopping after the current job is cancelled (press Ctrl+C again to force)`);
  if (currentJobId) void getRepo().requestJobCancel(currentJobId);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (e) => log.error("Unhandled rejection", { message: errorMessage(e) }));

main().catch((e) => {
  log.error("Worker crashed", { message: errorMessage(e) });
  process.exit(1);
});
