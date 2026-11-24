import dns from "node:dns/promises";
import net from "node:net";
import { getConfig } from "../config";

const TRACKING_PARAMS = /^(utm_[a-z]+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|_ga|_gl|yclid|igshid)$/i;
const SKIP_EXTENSIONS =
  /\.(pdf|zip|rar|7z|gz|tar|exe|dmg|msi|apk|jpg|jpeg|png|gif|webp|svg|ico|bmp|tiff?|mp3|mp4|m4a|wav|avi|mov|webm|ogg|woff2?|ttf|eot|otf|css|js|json|xml|rss|txt|csv|xlsx?|docx?|pptx?)$/i;

export class UrlValidationError extends Error {}

/** Parses and validates basic URL syntax (http/https only, no embedded credentials). */
export function parseHttpUrl(input: string): URL {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    throw new UrlValidationError(`Invalid URL: ${input}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new UrlValidationError(`Only http and https URLs are allowed (got ${u.protocol})`);
  }
  if (u.username || u.password) throw new UrlValidationError("URLs must not contain embedded credentials");
  if (!u.hostname) throw new UrlValidationError("URL has no hostname");
  return u;
}

/**
 * Canonical key for a page URL: lower-case host, no fragment, no default port, tracking params removed,
 * remaining query params sorted, trailing slash removed (except root).
 */
export function normalizeUrl(input: string, base?: string): string {
  const u = base ? new URL(input, base) : new URL(input);
  u.hash = "";
  u.hostname = u.hostname.toLowerCase();
  if ((u.protocol === "http:" && u.port === "80") || (u.protocol === "https:" && u.port === "443")) u.port = "";
  const params = [...u.searchParams.entries()].filter(([k]) => !TRACKING_PARAMS.test(k));
  params.sort(([a], [b]) => a.localeCompare(b));
  u.search = "";
  for (const [k, v] of params) u.searchParams.append(k, v);
  let p = u.pathname.replace(/\/{2,}/g, "/");
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  u.pathname = p || "/";
  return u.toString();
}

/** Host without leading www., used to decide whether a URL belongs to the configured site. */
export function siteHost(u: string | URL): string {
  const h = (typeof u === "string" ? new URL(u) : u).hostname.toLowerCase();
  return h.startsWith("www.") ? h.slice(4) : h;
}

export function isInternalUrl(url: string, baseUrl: string, extraDomains: string[] = []): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const h = siteHost(u);
    const base = new URL(baseUrl);
    if (h === siteHost(base) && (u.port || "") === (base.port || "")) return true;
    return extraDomains.some((d) => {
      const dd = d.toLowerCase().replace(/^www\./, "");
      return h === dd || h.endsWith("." + dd);
    });
  } catch {
    return false;
  }
}

export function isCrawlableUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === "http:" || u.protocol === "https:") && !SKIP_EXTENSIONS.test(u.pathname);
  } catch {
    return false;
  }
}

/** Converts a user-supplied glob-ish pattern ("*" wildcard) or /regex/ into a RegExp. */
export function patternToRegExp(pattern: string): RegExp | null {
  const p = pattern.trim();
  if (!p) return null;
  if (p.length > 2 && p.startsWith("/") && p.lastIndexOf("/") > 0) {
    const last = p.lastIndexOf("/");
    try {
      return new RegExp(p.slice(1, last), p.slice(last + 1).replace(/[^gimsuy]/g, ""));
    } catch {
      return null;
    }
  }
  const escaped = p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(escaped, "i");
}

export function matchesAnyPattern(url: string, patterns: string[]): boolean {
  return patterns.some((p) => patternToRegExp(p)?.test(url) ?? false);
}

// ---------------------------------------------------------------------------------------------
// SSRF protection
// ---------------------------------------------------------------------------------------------

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
}

const V4_BLOCKED: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const n = ipv4ToInt(ip);
    return V4_BLOCKED.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (n & mask) === (ipv4ToInt(base) & mask);
    });
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === "::" || v === "::1") return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    if (/^f[cd]/.test(v)) return true; // unique local fc00::/7
    if (/^fe[89ab]/.test(v)) return true; // link-local fe80::/10
    if (v.startsWith("ff")) return true; // multicast
    if (v.startsWith("64:ff9b:")) return true; // NAT64
    return false;
  }
  return true; // not an IP at all -> treat as unsafe
}

const hostDecisionCache = new Map<string, { ok: boolean; reason?: string; at: number }>();

/**
 * Throws UrlValidationError unless the URL is http(s) and its host resolves only to public addresses
 * (or is explicitly allow-listed via ALLOWED_PRIVATE_HOSTS / ALLOW_PRIVATE_NETWORKS).
 */
export async function assertSafeUrl(input: string): Promise<URL> {
  const u = parseHttpUrl(input);
  const cfg = getConfig();
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (cfg.allowPrivateNetworks || cfg.allowedPrivateHosts.includes(host)) return u;

  const cached = hostDecisionCache.get(host);
  if (cached && Date.now() - cached.at < 5 * 60_000) {
    if (!cached.ok) throw new UrlValidationError(cached.reason!);
    return u;
  }
  let addresses: string[];
  if (net.isIP(host)) addresses = [host];
  else {
    try {
      addresses = (await dns.lookup(host, { all: true, verbatim: true })).map((a) => a.address);
    } catch {
      // DNS failure is a reachability problem, not an SSRF problem: let the crawler report it.
      throw new UrlValidationError(`Could not resolve host "${host}"`);
    }
  }
  const bad = addresses.find((a) => isPrivateAddress(a));
  if (bad) {
    const reason = `Blocked: "${host}" resolves to a private/internal address (${bad}). Add it to ALLOWED_PRIVATE_HOSTS to allow.`;
    hostDecisionCache.set(host, { ok: false, reason, at: Date.now() });
    throw new UrlValidationError(reason);
  }
  hostDecisionCache.set(host, { ok: true, at: Date.now() });
  return u;
}

export async function isSafeUrl(input: string): Promise<boolean> {
  try {
    await assertSafeUrl(input);
    return true;
  } catch {
    return false;
  }
}

export function clearSsrfCacheForTests() {
  hostDecisionCache.clear();
}
