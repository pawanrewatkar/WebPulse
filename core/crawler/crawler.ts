import type { Browser, BrowserContext } from "playwright";
import { getRepo } from "../db";
import { getStorage, storageKeys } from "../storage";
import { BUILTIN_IGNORE_SELECTORS, RELATED_CONTENT_SELECTORS, SLIDER_SELECTORS, type WebsiteSettings } from "../settings";
import { canonicalPageKey, isBuilderTemplateUrl, isCrawlableUrl, isInternalUrl, isPaginatedListingUrl, matchesAnyPattern, normalizeUrl } from "../security/url";
import { errorMessage } from "../logger";
import { createDeviceContext, launchBrowser } from "./browser";
import { performLogin, LoginError } from "./auth";
import { capturePage } from "./capture";
import { discoverFromSitemaps } from "./discovery";
import { safeFetch } from "./net";
import { JobCancelledError, type JobContext } from "../jobs/context";
import type { CrawlRun, Device, LinkCheck, PageData, RunStats, Website } from "../types";

export interface CrawlOptions {
  /** URLs that must be visited (e.g. all pages of the baseline being compared against). */
  requiredUrls?: string[];
  /** Capture exactly these URLs; no discovery. */
  exactUrls?: string[];
  devices?: Device[];
}

interface QueueItem {
  url: string;
  key: string;
  depth: number;
  required: boolean;
}

/**
 * Crawls a website into an existing run record. Pages are captured for every configured device;
 * failures are recorded per page (never silently dropped) so comparisons can tell "failed to load"
 * apart from "removed".
 */
export async function crawlIntoRun(website: Website, run: CrawlRun, ctx: JobContext, opts: CrawlOptions = {}): Promise<RunStats> {
  const repo = getRepo();
  const storage = getStorage();
  const s: WebsiteSettings = website.settings;
  const devices = opts.devices ?? run.devices;
  const started = Date.now();
  const stats: RunStats = { discovered: 0, pagesPlanned: 0, captured: 0, failed: 0, httpErrors: 0, duplicatesSkipped: 0, linksChecked: 0, brokenLinks: 0 };
  const ignoreSelectors = [
    ...(s.builtInNoiseFilters ? BUILTIN_IGNORE_SELECTORS : []),
    ...(s.ignoreRelatedContent ? RELATED_CONTENT_SELECTORS : []),
    ...(s.ignoreSliders ? SLIDER_SELECTORS : []),
    ...s.ignoreSelectors,
  ];
  /** Pages never captured: builder templates always; extra listing pages when the option is on. */
  const skipped = (url: string) => isBuilderTemplateUrl(url) || (s.skipPaginatedListings && isPaginatedListingUrl(url));
  const baseKey = normalizeUrl(website.baseUrl);
  /** One key per real page: folds http/https, www, index files, tracking params, trailing slashes. */
  const pageKey = (u: string) => canonicalPageKey(u, website.baseUrl);

  const accept = (url: string) =>
    isCrawlableUrl(url) && isInternalUrl(url, website.baseUrl, s.allowedDomains) && !matchesAnyPattern(url, s.excludePatterns) && !skipped(url) &&
    !(s.auth && normalizeUrl(url) === normalizeUrl(s.auth.loginUrl));

  await repo.updateRun(run.id, { status: "running", startedAt: new Date().toISOString() });
  let browser: Browser | null = null;
  const contexts = new Map<Device, BrowserContext>();
  try {
    await ctx.progress(0.01, "Launching browser");
    browser = await launchBrowser();
    for (const d of devices) contexts.set(d, await createDeviceContext(browser, d));

    // ---- Authentication (each device context gets its own session)
    if (s.auth) {
      const creds = await repo.getWebsiteCredentials(website.id);
      if (!creds) throw new LoginError("Website is login-protected but no credentials are stored");
      for (const [d, c] of contexts) {
        await ctx.progress(0.02, `Logging in (${d})`);
        await performLogin(c, s.auth, creds, s.pageTimeoutMs, ctx.log);
      }
    }

    // ---- Build the queue
    const queue: QueueItem[] = [];
    const queued = new Set<string>();
    const enqueue = (url: string, depth: number, required = false) => {
      let key: string;
      try {
        key = pageKey(url);
      } catch {
        return;
      }
      if (queued.has(key)) return; // same page linked again (e.g. two CTAs with the same URL)
      if (!required && !accept(key)) return;
      if (required && (!/^https?:/.test(key) || (key !== baseKey && (matchesAnyPattern(key, s.excludePatterns) || skipped(key))))) return;
      queued.add(key);
      queue.push({ url: key, key, depth, required });
    };

    let limit: number;
    if (opts.exactUrls?.length) {
      for (const u of opts.exactUrls) enqueue(u, 0, true);
      limit = queue.length;
    } else {
      enqueue(baseKey, 0, true);
      for (const u of s.includeUrls) enqueue(u, 0, true);
      for (const u of opts.requiredUrls ?? []) enqueue(u, 0, true);
      const requiredCount = queue.length;
      if (s.useSitemap) {
        await ctx.progress(0.03, "Reading sitemap.xml");
        const firstCtx = contexts.get(devices[0])!;
        const sm = await discoverFromSitemaps(firstCtx.request, website.baseUrl, ctx.log).catch((e) => {
          ctx.log.warn(`Sitemap discovery failed: ${errorMessage(e)}`);
          return [] as string[];
        });
        for (const u of sm) enqueue(u, 1);
      }
      // Comparison crawls keep headroom above the baseline page count so new pages can be found.
      limit = opts.requiredUrls?.length ? Math.max(s.maxPages, requiredCount + Math.ceil(s.maxPages * 0.2)) : Math.max(s.maxPages, requiredCount);
    }

    // ---- Crawl
    const captured = new Set<string>();
    const pageDataForLinks: PageData[] = [];
    let processed = 0;
    while (queue.length && processed < limit) {
      await ctx.checkCancelled();
      // Required URLs first, then breadth-first.
      const idx = queue.findIndex((q) => q.required);
      const item = queue.splice(idx >= 0 ? idx : 0, 1)[0];
      if (captured.has(item.key)) continue;
      captured.add(item.key);
      processed++;
      stats.pagesPlanned = processed;
      const expected = Math.max(1, Math.min(limit, processed + queue.length));
      await ctx.progress(0.05 + 0.8 * ((processed - 1) / expected), `Capturing ${processed}/${expected}: ${item.url}`);

      for (const device of devices) {
        await ctx.checkCancelled();
        const res = await capturePage(contexts.get(device)!, item.url, {
          timeoutMs: s.pageTimeoutMs,
          waitAfterLoadMs: s.waitAfterLoadMs,
          maxScreenshotHeight: s.maxScreenshotHeight,
          ignoreSelectors,
          retries: s.retries,
          loginUrl: s.auth?.loginUrl ?? null,
        });
        // A discovered URL that redirects to a page that is already saved is the same page: do not store it twice.
        if (device === devices[0] && !item.required && res.status === "captured" && res.finalUrl) {
          let finalKey: string | null = null;
          try {
            finalKey = pageKey(res.finalUrl);
          } catch {
            /* ignore */
          }
          if (finalKey && finalKey !== item.key && captured.has(finalKey)) {
            stats.duplicatesSkipped!++;
            processed--;
            ctx.log.info(`Skipped duplicate: ${item.url} redirects to ${finalKey}, which is already saved`);
            break;
          }
        }
        const prefix = storageKeys.page(run.id, item.key, device);
        let screenshotPath = null,
          thumbPath = null,
          domPath = null,
          dataPath = null;
        if (res.screenshot) await storage.write((screenshotPath = `${prefix}/screenshot.png`), res.screenshot);
        if (res.thumbnail) await storage.write((thumbPath = `${prefix}/thumb.jpg`), res.thumbnail);
        if (res.html) await storage.write((domPath = `${prefix}/dom.html`), res.html);
        if (res.data) await storage.write((dataPath = `${prefix}/data.json`), JSON.stringify(res.data));
        await repo.savePage({
          runId: run.id,
          url: item.url,
          urlKey: item.key,
          device,
          status: res.status,
          httpStatus: res.httpStatus,
          finalUrl: res.finalUrl,
          error: res.error,
          title: res.title,
          screenshotPath,
          thumbPath,
          domPath,
          dataPath,
          screenshotWidth: res.screenshotWidth,
          screenshotHeight: res.screenshotHeight,
          contentHash: res.contentHash,
          loadMs: res.loadMs,
          attempts: res.attempts,
          capturedAt: new Date().toISOString(),
        });
        if (res.status === "captured") stats.captured!++;
        else if (res.status === "http_error") stats.httpErrors!++;
        else stats.failed!++;
        const level = res.status === "failed" ? "warn" : "info";
        ctx.log[level](`${device} ${item.url} → ${res.status}${res.httpStatus ? ` (${res.httpStatus})` : ""}${res.error ? ` – ${res.error}` : ""}`);

        // Discovery + link checking use the first device's links.
        if (device === devices[0] && res.data) {
          pageDataForLinks.push(res.data);
          if (res.finalUrl) {
            try {
              captured.add(pageKey(res.finalUrl));
            } catch {
              /* ignore */
            }
          }
          if (!opts.exactUrls?.length && s.followLinks && item.depth < s.maxDepth && res.status === "captured") {
            for (const l of res.data.links) enqueue(l.href, item.depth + 1);
          }
        }
      }
      stats.discovered = queued.size;
      await repo.updateRun(run.id, { stats });
      if (s.crawlDelayMs && queue.length) await new Promise((r) => setTimeout(r, s.crawlDelayMs));
    }
    if (queue.length && !opts.exactUrls?.length) ctx.log.info(`Page limit (${limit}) reached; ${queue.length} discovered URL(s) not captured`);

    // ---- Link checks
    if (s.checkLinks && pageDataForLinks.length) {
      await ctx.progress(0.87, "Checking links");
      const checks = await checkLinks(contexts.get(devices[0])!, pageDataForLinks, website, ctx);
      await repo.saveLinkChecks(run.id, checks);
      stats.linksChecked = checks.length;
      stats.brokenLinks = checks.filter((c) => !c.ok).length;
    }

    // Every URL discovered (captured or not) – lets comparisons tell "new page" from "beyond the page limit".
    await storage.write(`runs/${run.id}/discovered.json`, JSON.stringify([...queued]));

    stats.durationMs = Date.now() - started;
    const total = stats.captured! + stats.httpErrors! + stats.failed!;
    const status = total === 0 || stats.failed === total ? "failed" : stats.failed! > 0 ? "partial" : "completed";
    await repo.updateRun(run.id, {
      status,
      stats,
      finishedAt: new Date().toISOString(),
      error: status === "failed" ? "No page could be captured (see job log for per-page errors)" : stats.failed ? `${stats.failed} page capture(s) failed` : null,
    });
    ctx.log.info(`Crawl ${status}: ${stats.captured} captured, ${stats.httpErrors} HTTP errors, ${stats.failed} failed`);
    return stats;
  } catch (e) {
    stats.durationMs = Date.now() - started;
    const cancelled = e instanceof JobCancelledError;
    await repo.updateRun(run.id, { status: cancelled ? "cancelled" : "failed", stats, error: errorMessage(e), finishedAt: new Date().toISOString() });
    throw e;
  } finally {
    for (const c of contexts.values()) await c.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
}

async function checkLinks(context: BrowserContext, pages: PageData[], website: Website, ctx: JobContext): Promise<Omit<LinkCheck, "runId">[]> {
  const s = website.settings;
  const urls = new Set<string>();
  for (const p of pages)
    for (const l of p.links) {
      if (!/^https?:/i.test(l.href)) continue;
      let key: string;
      try {
        key = normalizeUrl(l.href);
      } catch {
        continue;
      }
      const internal = isInternalUrl(key, website.baseUrl, s.allowedDomains);
      if (!internal && !s.checkExternalLinks) continue;
      if (matchesAnyPattern(key, s.excludePatterns)) continue;
      urls.add(key);
    }
  // Images that did not render are verified over HTTP so "broken image" is evidence-based (checked first).
  const imgUrls = new Set<string>();
  for (const p of pages)
    for (const img of p.images) {
      if (img.loaded || !/^https?:/i.test(img.src)) continue;
      try {
        imgUrls.add(normalizeUrl(img.src));
      } catch {
        /* ignore */
      }
    }
  const results: Omit<LinkCheck, "runId">[] = [];
  let n = 0;
  // Unloaded images get a small reserved budget even when maxLinkChecks is 0.
  const budget = s.maxLinkChecks + 25;
  for (const url of new Set([...imgUrls, ...urls])) {
    if (n >= budget) break;
    await ctx.checkCancelled();
    n++;
    let r = await safeFetch(context.request, url, { method: "HEAD", timeoutMs: 15_000 });
    if (r.status === null || r.status === 405 || r.status === 501 || r.status === 403) {
      r = await safeFetch(context.request, url, { method: "GET", timeoutMs: 15_000 });
    }
    const ok = r.status !== null && r.status < 400;
    results.push({ url, status: r.status, ok, error: r.error ?? (ok ? null : `HTTP ${r.status}`) });
    if (!ok) ctx.log.info(`Broken link: ${url} → ${r.status ?? r.error}`);
  }
  if (urls.size + imgUrls.size > budget) ctx.log.info(`Link check limit reached (${s.maxLinkChecks} of ${urls.size} links checked)`);
  return results;
}
