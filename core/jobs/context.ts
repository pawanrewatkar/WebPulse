import { getRepo } from "../db";
import { createLogger, type Logger } from "../logger";
import type { Job } from "../types";

export class JobCancelledError extends Error {
  constructor() {
    super("Job was cancelled by user");
  }
}

/** Passed to job handlers: progress reporting, persistent logs, cancellation checks. */
export interface JobContext {
  job: Job;
  log: Logger;
  progress(fraction: number, message?: string): Promise<void>;
  checkCancelled(): Promise<void>;
}

export function createJobContext(job: Job): JobContext {
  const repo = getRepo();
  const log = createLogger(`job#${job.id}`, (level, msg) => {
    void repo.addJobLog(job.id, level, msg).catch(() => {});
  });
  let lastWrite = 0;
  return {
    job,
    log,
    async progress(fraction, message) {
      const now = Date.now();
      // Throttle DB writes, but always write messages.
      if (message || now - lastWrite > 1000) {
        lastWrite = now;
        await repo.updateJob(job.id, { progress: Math.max(0, Math.min(1, fraction)), message: message ?? undefined });
      }
    },
    async checkCancelled() {
      if (await repo.isJobCancelRequested(job.id)) throw new JobCancelledError();
    },
  };
}

/** Context for running jobs directly from the CLI (no DB job row). */
export function createCliContext(job: Job): JobContext {
  const log = createLogger(`cli:${job.type}`);
  return {
    job,
    log,
    async progress(fraction, message) {
      if (message) log.info(`[${Math.round(fraction * 100)}%] ${message}`);
    },
    async checkCancelled() {},
  };
}
