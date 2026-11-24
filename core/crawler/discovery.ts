import type { APIRequestContext } from "playwright";
import { safeFetch } from "./net";
import type { Logger } from "../logger";

const decodeXml = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();

export function parseSitemap(xml: string): { urls: string[]; sitemaps: string[] } {
  const locs = [...xml.matchAll(/<loc>([\s\S]*?)<\/loc>/gi)].map((m) => decodeXml(m[1]));
  if (/<sitemapindex[\s>]/i.test(xml)) return { urls: [], sitemaps: locs };
  return { urls: locs, sitemaps: [] };
}

export function parseRobotsSitemaps(robots: string): string[] {
  return robots
    .split(/\r?\n/)
    .map((l) => l.match(/^\s*sitemap:\s*(\S+)/i)?.[1])
    .filter((x): x is string => !!x);
}

/** Collects page URLs from robots.txt-declared sitemaps and /sitemap.xml (following sitemap indexes). */
export async function discoverFromSitemaps(request: APIRequestContext, baseUrl: string, log: Logger, maxUrls = 5000): Promise<string[]> {
  const origin = new URL(baseUrl).origin;
  const queue: string[] = [];
  const robots = await safeFetch(request, `${origin}/robots.txt`, { readBody: true, maxBytes: 512 * 1024 });
  if (robots.status === 200 && robots.body) queue.push(...parseRobotsSitemaps(robots.body));
  queue.push(`${origin}/sitemap.xml`);

  const seen = new Set<string>();
  const urls: string[] = [];
  let fetched = 0;
  while (queue.length && fetched < 25 && urls.length < maxUrls) {
    const sm = queue.shift()!;
    if (seen.has(sm)) continue;
    seen.add(sm);
    if (/\.gz$/i.test(sm)) {
      log.warn(`Skipping compressed sitemap ${sm} (not supported)`);
      continue;
    }
    fetched++;
    const res = await safeFetch(request, sm, { readBody: true });
    if (res.status !== 200 || !res.body) {
      if (res.status !== 404) log.info(`Sitemap ${sm} not available (${res.status ?? res.error})`);
      continue;
    }
    const parsed = parseSitemap(res.body);
    queue.push(...parsed.sitemaps);
    urls.push(...parsed.urls);
  }
  if (urls.length) log.info(`Sitemap discovery found ${urls.length} URL(s)`);
  return urls.slice(0, maxUrls);
}
