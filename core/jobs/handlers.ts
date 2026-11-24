import { getRepo } from "../db";
import { crawlIntoRun } from "../crawler/crawler";
import { compareRuns } from "../compare/engine";
import type { JobContext } from "./context";
import type { Device } from "../types";

async function loadWebsite(id: number | null) {
  if (!id) throw new Error("Job has no website");
  const w = await getRepo().getWebsite(id);
  if (!w) throw new Error(`Website ${id} no longer exists`);
  return w;
}

/** "Save Website": crawl into a new baseline version. Never modifies existing baselines. */
async function baselineJob(ctx: JobContext) {
  const repo = getRepo();
  const website = await loadWebsite(ctx.job.websiteId);
  const run = await repo.createRun({
    websiteId: website.id,
    kind: "baseline",
    label: (ctx.job.payload.label as string) ?? null,
    devices: website.settings.devices,
    jobId: ctx.job.id,
    settingsSnapshot: website.settings,
  });
  ctx.log.info(`Creating baseline v${run.version} for ${website.baseUrl}`);
  const stats = await crawlIntoRun(website, run, ctx);
  const finished = await repo.getRun(run.id);
  const usable = finished?.status === "completed" || finished?.status === "partial";
  if (usable && ctx.job.payload.setActive !== false) {
    await repo.setActiveBaseline(website.id, run.id);
    ctx.log.info(`Baseline v${run.version} is now the active baseline`);
  }
  if (!usable) throw new Error(finished?.error ?? "Baseline crawl failed");
  return {
    runId: run.id,
    version: run.version,
    ...stats,
    message: `Baseline v${run.version} saved: ${stats.captured} captures${stats.failed ? `, ${stats.failed} failed` : ""}${stats.httpErrors ? `, ${stats.httpErrors} HTTP errors` : ""}`,
  };
}

/** Ad-hoc capture of specific URLs (used for manual comparisons in the Baseline Explorer). */
async function captureJob(ctx: JobContext) {
  const repo = getRepo();
  const website = await loadWebsite(ctx.job.websiteId);
  const urls = (ctx.job.payload.urls as string[]) ?? [];
  const devices = ((ctx.job.payload.devices as Device[]) ?? website.settings.devices).filter((d) => d === "desktop" || d === "mobile");
  const run = await repo.createRun({ websiteId: website.id, kind: "capture", label: `Manual capture (${urls.length} URL)`, devices, jobId: ctx.job.id, settingsSnapshot: website.settings });
  const stats = await crawlIntoRun(website, run, ctx, { exactUrls: urls, devices });
  return { runId: run.id, ...stats, message: `Captured ${stats.captured} page view(s)${stats.failed ? `, ${stats.failed} failed` : ""}` };
}

/** "Compare Website": fresh crawl (visiting every baseline URL), then comparison against the baseline. */
async function compareJob(ctx: JobContext) {
  const repo = getRepo();
  const website = await loadWebsite(ctx.job.websiteId);
  const baseline = await repo.getRun(Number(ctx.job.payload.baselineRunId));
  if (!baseline || baseline.websiteId !== website.id || baseline.kind !== "baseline") throw new Error("Baseline not found");
  const baselinePages = await repo.listPages(baseline.id);
  const requiredUrls = [...new Set(baselinePages.map((p) => p.url))];
  // Compare the devices captured in the baseline (that are still configured, or all baseline devices if none overlap).
  const devices = baseline.devices.filter((d) => website.settings.devices.includes(d));
  const current = await repo.createRun({
    websiteId: website.id,
    kind: "comparison",
    label: `Comparison crawl vs baseline v${baseline.version}`,
    devices: devices.length ? devices : baseline.devices,
    jobId: ctx.job.id || null,
    settingsSnapshot: website.settings,
  });
  ctx.log.info(`Comparing ${website.baseUrl} against baseline v${baseline.version} (${requiredUrls.length} baseline URL(s))`);
  const stats = await crawlIntoRun(website, current, ctx, { requiredUrls });
  await ctx.progress(0.88, "Comparing against baseline");
  const comparisonId = await compareRuns({ websiteId: website.id, baseline, current: (await repo.getRun(current.id))!, ctx });
  const cmp = await repo.getComparison(comparisonId);
  return {
    comparisonId,
    runId: current.id,
    ...stats,
    message: `Comparison #${comparisonId}: ${cmp?.summary?.totalChanges ?? 0} change(s) on ${cmp?.summary?.pagesChanged ?? 0} page view(s)${cmp?.summary?.pagesFailed ? `, ${cmp.summary.pagesFailed} crawl failure(s)` : ""}`,
  };
}

/** Re-run the comparison engine on two stored runs without crawling. */
async function recompareJob(ctx: JobContext) {
  const repo = getRepo();
  const website = await loadWebsite(ctx.job.websiteId);
  const [baseline, current] = await Promise.all([repo.getRun(Number(ctx.job.payload.baselineRunId)), repo.getRun(Number(ctx.job.payload.currentRunId))]);
  if (!baseline || !current) throw new Error("Run not found");
  const comparisonId = await compareRuns({ websiteId: website.id, baseline, current, ctx });
  const cmp = await repo.getComparison(comparisonId);
  return { comparisonId, message: `Comparison #${comparisonId}: ${cmp?.summary?.totalChanges ?? 0} change(s)` };
}

export async function runJob(ctx: JobContext): Promise<Record<string, unknown>> {
  switch (ctx.job.type) {
    case "baseline":
      return baselineJob(ctx);
    case "capture":
      return captureJob(ctx);
    case "compare":
      return compareJob(ctx);
    case "recompare":
      return recompareJob(ctx);
    default:
      throw new Error(`Unsupported job type "${ctx.job.type}"`);
  }
}
