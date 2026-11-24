import crypto from "node:crypto";
import { getRepo } from "../db";
import { getStorage, storageKeys, pageSlug } from "../storage";
import { parseSettings, type WebsiteSettings } from "../settings";
import { errorMessage } from "../logger";
import type { JobContext } from "../jobs/context";
import type {
  ChangeEvidence,
  ComparisonSummary,
  CrawlRun,
  LinkCheck,
  NewChange,
  PageCapture,
  PageData,
  PageSummary,
  ReviewStatus,
  Severity,
} from "../types";
import { detectChanges, type Detected } from "./detectors";
import { buildTextFilters } from "./text";
import { cropImage, visualDiff } from "./visual";

export function fingerprintOf(c: { urlKey: string; device: string; category: string; changeType: string; expected: string | null; actual: string | null }) {
  return crypto
    .createHash("sha1")
    .update([c.urlKey, c.device, c.category, c.changeType, c.expected ?? "", c.actual ?? ""].join("\u0001"))
    .digest("hex")
    .slice(0, 20);
}

async function loadData(p: PageCapture): Promise<PageData | null> {
  if (!p.dataPath) return null;
  try {
    return JSON.parse(await getStorage().readText(p.dataPath)) as PageData;
  } catch {
    return null;
  }
}

function visualSeverity(pct: number): Severity {
  return pct >= 15 ? "high" : pct >= 3 ? "medium" : "low";
}

export interface PairResult {
  detected: Detected[];
  visual: null | { diffPercent: number; diffKey: string | null; regions: { x: number; y: number; width: number; height: number }[]; beforeHeight: number; afterHeight: number };
  evidenceByIndex: Map<number, ChangeEvidence>;
}

/**
 * Compares two captures of the same page and device: structured detectors + pixel diff + evidence crops.
 * `outPrefix` is the storage folder where diff images and crops are written.
 */
export async function comparePagePair(
  before: PageCapture,
  after: PageCapture,
  settings: WebsiteSettings,
  checks: { before: LinkCheck[]; after: LinkCheck[] },
  outPrefix: string,
  opts: { maxCrops?: number } = {},
): Promise<PairResult> {
  const storage = getStorage();
  const [bd, ad] = await Promise.all([loadData(before), loadData(after)]);
  const detected: Detected[] = [];
  if (bd && ad) {
    detected.push(
      ...detectChanges(bd, ad, {
        textFilters: buildTextFilters(settings),
        linkChecksBefore: new Map(checks.before.map((c) => [c.url, c])),
        linkChecksAfter: new Map(checks.after.map((c) => [c.url, c])),
        device: after.device,
      }),
    );
  }

  let visual: PairResult["visual"] = null;
  let beforePng: Buffer | null = null;
  let afterPng: Buffer | null = null;
  if (before.screenshotPath && after.screenshotPath) {
    [beforePng, afterPng] = await Promise.all([storage.read(before.screenshotPath), storage.read(after.screenshotPath)]);
    const v = await visualDiff(beforePng, afterPng, { threshold: settings.visualThreshold, maxHeight: settings.maxScreenshotHeight });
    let diffKey: string | null = null;
    if (v.diffPercent >= settings.visualMinDiffPercent) {
      diffKey = `${outPrefix}/diff.png`;
      await storage.write(diffKey, v.diffPng);
      const heightNote =
        Math.abs(v.beforeHeight - v.afterHeight) > 2 ? ` Page height changed from ${v.beforeHeight}px to ${v.afterHeight}px, so content below a change may appear shifted.` : "";
      detected.unshift({
        category: "visual",
        changeType: "modified",
        severity: visualSeverity(v.diffPercent),
        description: `Visual difference: ${v.diffPercent.toFixed(2)}% of pixels changed in ${v.regions.length} region(s).${heightNote}`,
        expected: `Matches baseline screenshot (${before.screenshotWidth}×${v.beforeHeight}px)`,
        actual: `${v.diffPercent.toFixed(2)}% pixels differ (${after.screenshotWidth}×${v.afterHeight}px)`,
        selector: null,
        beforeBox: v.regions[0] ? [v.regions[0].x, v.regions[0].y, v.regions[0].width, v.regions[0].height] : null,
        afterBox: v.regions[0] ? [v.regions[0].x, v.regions[0].y, v.regions[0].width, v.regions[0].height] : null,
        details: v.regions.map((r) => `Region at x=${r.x}, y=${r.y} (${r.width}×${r.height}px)`),
      });
    }
    visual = { diffPercent: v.diffPercent, diffKey, regions: v.regions, beforeHeight: v.beforeHeight, afterHeight: v.afterHeight };
  }

  // Evidence: page screenshots for every change + element crops where we know the element box.
  const evidenceByIndex = new Map<number, ChangeEvidence>();
  let crops = 0;
  const maxCrops = opts.maxCrops ?? 40;
  for (let i = 0; i < detected.length; i++) {
    const d = detected[i];
    const ev: ChangeEvidence = {
      baselineScreenshot: before.screenshotPath,
      currentScreenshot: after.screenshotPath,
      baselinePageId: before.id,
      currentPageId: after.id,
      details: d.details,
    };
    if (d.category === "visual" && visual) {
      ev.diffImage = visual.diffKey;
      ev.diffPercent = visual.diffPercent;
      ev.regions = visual.regions;
    }
    if (crops < maxCrops) {
      try {
        if (d.beforeBox && beforePng) {
          const c = await cropImage(beforePng, d.beforeBox);
          if (c) await storage.write((ev.baselineCrop = `${outPrefix}/crop-${i}-before.jpg`), c);
        }
        if (d.afterBox && afterPng) {
          const c = await cropImage(afterPng, d.afterBox);
          if (c) await storage.write((ev.currentCrop = `${outPrefix}/crop-${i}-after.jpg`), c);
        }
        if (ev.baselineCrop || ev.currentCrop) crops++;
      } catch {
        /* crops are best-effort evidence */
      }
    }
    evidenceByIndex.set(i, ev);
  }
  return { detected, visual, evidenceByIndex };
}

/** Compares a current run against a baseline run and stores the comparison, changes and summary. */
export async function compareRuns(params: { websiteId: number; baseline: CrawlRun; current: CrawlRun; ctx: JobContext }): Promise<number> {
  const { websiteId, baseline, current, ctx } = params;
  const repo = getRepo();
  const website = await repo.getWebsite(websiteId);
  if (!website) throw new Error("Website not found");
  // Use current website settings for noise filtering/thresholds (users tune them between comparisons).
  const settings = parseSettings(website.settings);
  const comparison = await repo.createComparison({ websiteId, baselineRunId: baseline.id, currentRunId: current.id, jobId: ctx.job.id || null });
  try {
    const [bPages, cPages, bChecks, cChecks, rules] = await Promise.all([
      repo.listPages(baseline.id),
      repo.listPages(current.id),
      repo.listLinkChecks(baseline.id),
      repo.listLinkChecks(current.id),
      repo.listIgnoreRules(websiteId),
    ]);
    const ignored = new Set(rules.map((r) => r.fingerprint));
    const k = (p: PageCapture) => `${p.urlKey}|${p.device}`;
    const bMap = new Map(bPages.map((p) => [k(p), p]));
    const cMap = new Map(cPages.map((p) => [k(p), p]));
    const keys = [...new Set([...bMap.keys(), ...cMap.keys()])].sort();
    const summaries: PageSummary[] = [];
    const allChanges: Array<NewChange & { reviewStatus?: ReviewStatus; autoIgnored?: boolean }> = [];
    let autoIgnored = 0;

    let idx = 0;
    for (const key of keys) {
      await ctx.checkCancelled();
      idx++;
      const b = bMap.get(key) ?? null;
      const c = cMap.get(key) ?? null;
      const ref = (c ?? b)!;
      await ctx.progress(0.88 + 0.1 * (idx / keys.length), `Comparing ${idx}/${keys.length}: ${ref.url} (${ref.device})`);
      const pageChanges: Array<Detected & { evidence: ChangeEvidence }> = [];
      const summary: PageSummary = {
        url: ref.url,
        urlKey: ref.urlKey,
        device: ref.device,
        title: c?.title ?? b?.title ?? null,
        status: "unchanged",
        baselinePageId: b?.id ?? null,
        currentPageId: c?.id ?? null,
        changeCount: 0,
        bySeverity: {},
        visualDiffPercent: null,
      };
      const baseEvidence = (): ChangeEvidence => ({
        baselineScreenshot: b?.screenshotPath ?? null,
        currentScreenshot: c?.screenshotPath ?? null,
        baselinePageId: b?.id ?? null,
        currentPageId: c?.id ?? null,
      });
      const pageLevel = (d: Omit<Detected, "category" | "selector"> & { selector?: null }) => pageChanges.push({ ...d, category: "page", selector: null, evidence: baseEvidence() });

      if (b && !c) {
        summary.status = "not_checked";
        summary.note = current.devices.includes(b.device)
          ? "Not captured in the current crawl (URL excluded, page limit reached, or crawl stopped). Not verified – not reported as removed."
          : `Device "${b.device}" was not part of the current crawl.`;
      } else if (!b && c) {
        if (c.status === "captured") {
          summary.status = "new_page";
          pageLevel({ changeType: "added", severity: "medium", description: "New page found that is not in the baseline", expected: null, actual: `${c.url} – "${c.title ?? ""}"` });
        } else if (c.status === "http_error") {
          summary.status = "http_error";
          pageLevel({ changeType: "potentially_broken", severity: "high", description: `New URL linked from the site returns HTTP ${c.httpStatus}`, expected: null, actual: `${c.url} → HTTP ${c.httpStatus}` });
        } else {
          summary.status = "crawl_failed";
          summary.note = c.error ?? "Capture failed";
        }
      } else if (b && c) {
        if (b.status === "failed") {
          summary.status = "not_checked";
          summary.note = `Baseline capture of this page had failed (${b.error ?? "unknown error"}); no reference to compare against.`;
        } else if (c.status === "failed") {
          summary.status = "crawl_failed";
          summary.note = c.error ?? "Capture failed";
          pageLevel({
            changeType: "potentially_broken",
            severity: "high",
            description: "Page could not be loaded during the current crawl. This is a crawl failure, NOT a confirmed removal – verify manually.",
            expected: b.status === "captured" ? `Page loads (HTTP ${b.httpStatus ?? 200})` : `HTTP ${b.httpStatus}`,
            actual: c.error ?? "Capture failed",
          });
        } else if (b.status === "captured" && c.status === "http_error") {
          const gone = c.httpStatus === 404 || c.httpStatus === 410;
          summary.status = gone ? "removed" : "http_error";
          pageLevel({
            changeType: gone ? "removed" : "potentially_broken",
            severity: "critical",
            description: gone ? `Page removed: now returns HTTP ${c.httpStatus}` : `Page now returns an error: HTTP ${c.httpStatus}`,
            expected: `HTTP ${b.httpStatus ?? 200} – "${b.title ?? ""}"`,
            actual: `HTTP ${c.httpStatus}`,
          });
        } else if (b.status === "http_error" && c.status === "captured") {
          summary.status = "changed";
          pageLevel({ changeType: "modified", severity: "medium", description: `Page now loads successfully (was HTTP ${b.httpStatus} in baseline)`, expected: `HTTP ${b.httpStatus}`, actual: `HTTP ${c.httpStatus ?? 200} – "${c.title ?? ""}"` });
        } else if (b.status === "http_error" && c.status === "http_error") {
          summary.status = "http_error";
          if (b.httpStatus !== c.httpStatus) pageLevel({ changeType: "modified", severity: "low", description: "HTTP error status changed", expected: `HTTP ${b.httpStatus}`, actual: `HTTP ${c.httpStatus}` });
        } else {
          // Both captured: full comparison.
          try {
            const outPrefix = `${storageKeys.comparison(comparison.id)}/${pageSlug(c.urlKey)}/${c.device}`;
            const pair = await comparePagePair(b, c, settings, { before: bChecks, after: cChecks }, outPrefix);
            pair.detected.forEach((d, i) => pageChanges.push({ ...d, evidence: pair.evidenceByIndex.get(i)! }));
            summary.visualDiffPercent = pair.visual?.diffPercent ?? null;
          } catch (e) {
            summary.status = "not_checked";
            summary.note = `Comparison error: ${errorMessage(e)}`;
            ctx.log.warn(`Comparison of ${c.url} (${c.device}) failed: ${errorMessage(e)}`);
          }
        }
      }

      for (const d of pageChanges) {
        const change = {
          url: ref.url,
          urlKey: ref.urlKey,
          device: ref.device,
          pageTitle: summary.title,
          category: d.category,
          changeType: d.changeType,
          severity: d.severity,
          description: d.description,
          expected: d.expected,
          actual: d.actual,
          selector: d.selector,
          evidence: d.evidence,
          fingerprint: "",
        };
        change.fingerprint = fingerprintOf(change);
        const isIgnored = ignored.has(change.fingerprint);
        if (isIgnored) autoIgnored++;
        allChanges.push({ ...change, reviewStatus: isIgnored ? "ignored" : "pending", autoIgnored: isIgnored });
        if (!isIgnored) {
          summary.changeCount++;
          summary.bySeverity[d.severity] = (summary.bySeverity[d.severity] ?? 0) + 1;
        }
      }
      if (summary.status === "unchanged" && summary.changeCount > 0) summary.status = "changed";
      summaries.push(summary);
    }

    await repo.insertChanges(comparison.id, allChanges);
    const counted = allChanges.filter((c) => !c.autoIgnored);
    const tally = <K extends string>(f: (c: (typeof counted)[number]) => K) =>
      counted.reduce((acc, c) => ((acc[f(c)] = (acc[f(c)] ?? 0) + 1), acc), {} as Partial<Record<K, number>>);
    const summary: ComparisonSummary = {
      totalChanges: counted.length,
      autoIgnored,
      byCategory: tally((c) => c.category),
      bySeverity: tally((c) => c.severity),
      byType: tally((c) => c.changeType),
      pages: summaries,
      pagesCompared: summaries.filter((s) => s.status === "changed" || s.status === "unchanged").length,
      pagesChanged: summaries.filter((s) => s.status === "changed").length,
      pagesUnchanged: summaries.filter((s) => s.status === "unchanged").length,
      pagesNew: summaries.filter((s) => s.status === "new_page").length,
      pagesRemoved: summaries.filter((s) => s.status === "removed").length,
      pagesFailed: summaries.filter((s) => s.status === "crawl_failed").length,
      pagesNotChecked: summaries.filter((s) => s.status === "not_checked").length,
    };
    await repo.updateComparison(comparison.id, { status: "completed", summary, finishedAt: new Date().toISOString() });
    ctx.log.info(
      `Comparison #${comparison.id}: ${summary.totalChanges} change(s) on ${summary.pagesChanged} page view(s); ${summary.pagesFailed} crawl failure(s); ${autoIgnored} auto-ignored`,
    );
    return comparison.id;
  } catch (e) {
    await repo.updateComparison(comparison.id, { status: "failed", error: errorMessage(e), finishedAt: new Date().toISOString() });
    throw e;
  }
}
