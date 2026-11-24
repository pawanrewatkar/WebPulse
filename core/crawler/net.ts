import type { APIRequestContext, APIResponse } from "playwright";
import { assertSafeUrl } from "../security/url";
import { errorMessage } from "../logger";

export interface SafeFetchResult {
  status: number | null;
  finalUrl: string;
  body?: string;
  error?: string;
}

/**
 * HTTP request through Playwright's request context (shares cookies with the authenticated browser
 * context). Redirects are followed manually so every hop passes the SSRF check.
 */
export async function safeFetch(
  request: APIRequestContext,
  url: string,
  opts: { method?: "GET" | "HEAD"; timeoutMs?: number; readBody?: boolean; maxBytes?: number } = {},
): Promise<SafeFetchResult> {
  let current = url;
  for (let hop = 0; hop <= 5; hop++) {
    try {
      await assertSafeUrl(current);
    } catch (e) {
      return { status: null, finalUrl: current, error: errorMessage(e) };
    }
    let res: APIResponse;
    try {
      res = await request.fetch(current, {
        method: opts.method ?? "GET",
        timeout: opts.timeoutMs ?? 15_000,
        maxRedirects: 0,
        failOnStatusCode: false,
        ignoreHTTPSErrors: false,
      });
    } catch (e) {
      return { status: null, finalUrl: current, error: errorMessage(e) };
    }
    const status = res.status();
    if (status >= 300 && status < 400 && res.headers()["location"]) {
      current = new URL(res.headers()["location"], current).toString();
      await res.dispose();
      continue;
    }
    let body: string | undefined;
    if (opts.readBody && status < 400) {
      const buf = await res.body();
      body = buf.subarray(0, opts.maxBytes ?? 10 * 1024 * 1024).toString("utf8");
    }
    await res.dispose();
    return { status, finalUrl: current, body };
  }
  return { status: null, finalUrl: current, error: "Too many redirects" };
}
