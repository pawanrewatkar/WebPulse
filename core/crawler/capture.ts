import crypto from "node:crypto";
import type { BrowserContext } from "playwright";
import sharp from "sharp";
import { buildNoiseCss, EXTRACT_SCRIPT, FREEZE_SLIDERS_SCRIPT, SETTLE_SCRIPT } from "./extract";
import { errorMessage } from "../logger";
import { normalizeUrl } from "../security/url";
import type { PageData, PageStatus } from "../types";

export interface CaptureOptions {
  timeoutMs: number;
  waitAfterLoadMs: number;
  maxScreenshotHeight: number;
  ignoreSelectors: string[];
  retries: number;
  loginUrl?: string | null;
}

export interface CaptureResult {
  status: PageStatus;
  httpStatus: number | null;
  finalUrl: string | null;
  error: string | null;
  title: string | null;
  data: PageData | null;
  screenshot: Buffer | null;
  thumbnail: Buffer | null;
  screenshotWidth: number | null;
  screenshotHeight: number | null;
  html: string | null;
  contentHash: string | null;
  loadMs: number | null;
  attempts: number;
}

function friendlyError(e: unknown): string {
  const msg = errorMessage(e);
  if (/Timeout .*exceeded/i.test(msg)) return `Timed out loading page (${msg.match(/Timeout (\d+)ms/)?.[1] ?? "?"} ms)`;
  if (/ERR_NAME_NOT_RESOLVED/.test(msg)) return "DNS lookup failed (host not found)";
  if (/ERR_CONNECTION_REFUSED/.test(msg)) return "Connection refused";
  if (/ERR_BLOCKED_BY_CLIENT/.test(msg)) return "Blocked by SSRF protection (private/internal address)";
  if (/ERR_CERT|SSL/i.test(msg)) return `TLS/certificate error: ${msg}`;
  if (/ERR_ABORTED/.test(msg)) return "Navigation aborted (download or blocked resource)";
  return msg;
}

/** origin + path, ignoring query (e.g. /login?next=/account matches /login). */
function pathKey(u: string): string {
  const n = new URL(normalizeUrl(u));
  return n.origin + n.pathname;
}

export function contentHashOf(data: PageData): string {
  const h = crypto.createHash("sha1");
  h.update(data.title);
  for (const x of data.headings) h.update(`h${x.level}:${x.text}\n`);
  for (const x of data.textBlocks) h.update(x.text + "\n");
  return h.digest("hex");
}

/** Loads one URL in a fresh page and captures screenshot, DOM and extracted data, with retries. */
export async function capturePage(context: BrowserContext, url: string, opts: CaptureOptions): Promise<CaptureResult> {
  let lastError = "";
  const maxAttempts = 1 + Math.max(0, opts.retries);
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const page = await context.newPage();
    const started = Date.now();
    try {
      page.setDefaultTimeout(opts.timeoutMs);
      const response = await page.goto(url, { waitUntil: "load", timeout: opts.timeoutMs });
      const httpStatus = response?.status() ?? 200;
      if (httpStatus >= 500 && attempt < maxAttempts) {
        lastError = `HTTP ${httpStatus}`;
        await page.close().catch(() => {});
        await new Promise((r) => setTimeout(r, 1000 * attempt));
        continue;
      }
      await page.waitForLoadState("networkidle", { timeout: Math.min(10_000, opts.timeoutMs) }).catch(() => {});
      const loadMs = Date.now() - started;
      const finalUrl = page.url();

      // Session lost / not authenticated: treat as a failed capture, never as content.
      if (opts.loginUrl && finalUrl && pathKey(finalUrl) === pathKey(opts.loginUrl) && pathKey(url) !== pathKey(opts.loginUrl)) {
        await page.close().catch(() => {});
        return emptyResult("failed", httpStatus, finalUrl, "Redirected to the login page – session is not authenticated", attempt);
      }

      await page.addStyleTag({ content: buildNoiseCss(opts.ignoreSelectors) }).catch(() => {});
      await page.evaluate(`(${SETTLE_SCRIPT})(${opts.maxScreenshotHeight})`).catch(() => {});
      // Show every slider on its first slide so each visit captures the same image.
      const frozen = (await page.evaluate(`(${FREEZE_SLIDERS_SCRIPT})()`).catch(() => 0)) as number;
      if (frozen > 0) await page.waitForTimeout(1500); // let the slide transition finish
      if (opts.waitAfterLoadMs) await page.waitForTimeout(opts.waitAfterLoadMs);

      const data = (await page.evaluate(`(${EXTRACT_SCRIPT})(${JSON.stringify({ ignoreSelectors: opts.ignoreSelectors, requestedUrl: url })})`)) as PageData;
      const html = await page.content();

      const vp = page.viewportSize()!;
      const fullHeight = Math.max(vp.height, data.layout.scrollHeight);
      const shotHeight = Math.min(fullHeight, opts.maxScreenshotHeight);
      const screenshot = await page.screenshot({
        fullPage: true,
        animations: "disabled",
        caret: "hide",
        type: "png",
        clip: { x: 0, y: 0, width: vp.width, height: shotHeight },
      });
      const meta = await sharp(screenshot).metadata();
      const thumbnail = await sharp(screenshot).resize(400, 300, { fit: "cover", position: "top" }).jpeg({ quality: 70 }).toBuffer();

      await page.close().catch(() => {});
      return {
        status: httpStatus >= 400 ? "http_error" : "captured",
        httpStatus,
        finalUrl,
        error: httpStatus >= 400 ? `HTTP ${httpStatus}` : fullHeight > shotHeight ? `Screenshot truncated at ${shotHeight}px (page is ${fullHeight}px)` : null,
        title: data.title || null,
        data,
        screenshot,
        thumbnail,
        screenshotWidth: meta.width ?? vp.width,
        screenshotHeight: meta.height ?? shotHeight,
        html,
        contentHash: contentHashOf(data),
        loadMs,
        attempts: attempt,
      };
    } catch (e) {
      lastError = friendlyError(e);
      await page.close().catch(() => {});
      if (attempt < maxAttempts && !/SSRF/.test(lastError)) await new Promise((r) => setTimeout(r, 1000 * attempt));
      else break;
    }
  }
  return emptyResult("failed", null, null, `${lastError} (after ${maxAttempts} attempt${maxAttempts > 1 ? "s" : ""})`, maxAttempts);
}

function emptyResult(status: PageStatus, httpStatus: number | null, finalUrl: string | null, error: string, attempts: number): CaptureResult {
  return {
    status,
    httpStatus,
    finalUrl,
    error,
    title: null,
    data: null,
    screenshot: null,
    thumbnail: null,
    screenshotWidth: null,
    screenshotHeight: null,
    html: null,
    contentHash: null,
    loadMs: null,
    attempts,
  };
}
