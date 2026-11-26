"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Website } from "@core/types";

type Mode = { kind: "create" } | { kind: "edit"; website: Website };

/** Upper limit of the crawler (see core/settings.ts maxPages / maxDepth). */
const WHOLE_SITE_PAGES = 1000;
const WHOLE_SITE_DEPTH = 10;

const lines = (v: string) => v.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
const sec = (ms: number) => String(ms / 1000);

export default function WebsiteForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const w = mode.kind === "edit" ? mode.website : null;
  const s = w?.settings;

  const [name, setName] = useState(w?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(w?.baseUrl ?? "");
  const [devices, setDevices] = useState<string[]>(s?.devices ?? ["desktop", "mobile"]);

  // What to crawl
  const [scope, setScope] = useState<"whole" | "limit">(!s || s.maxPages >= WHOLE_SITE_PAGES ? "whole" : "limit");
  const [maxPages, setMaxPages] = useState(String(s && s.maxPages < WHOLE_SITE_PAGES ? s.maxPages : 25));
  const [useSitemap, setUseSitemap] = useState(s?.useSitemap ?? true);
  const [followLinks, setFollowLinks] = useState(s?.followLinks ?? true);
  const [checkLinks, setCheckLinks] = useState(s?.checkLinks ?? true);
  const [includeUrls, setIncludeUrls] = useState((s?.includeUrls ?? []).join("\n"));
  const [excludePatterns, setExcludePatterns] = useState((s?.excludePatterns ?? []).join("\n"));

  // Speed & reliability (shown in seconds, stored in ms)
  const [speed, setSpeed] = useState({
    depth: String(s && s.maxPages < WHOLE_SITE_PAGES ? s.maxDepth : 3),
    delay: sec(s?.crawlDelayMs ?? 500),
    timeout: sec(s?.pageTimeoutMs ?? 45000),
    retries: String(s?.retries ?? 2),
    settle: sec(s?.waitAfterLoadMs ?? 750),
  });

  // Optional: ignore dynamic content
  const [ignoreSelectors, setIgnoreSelectors] = useState((s?.ignoreSelectors ?? []).join("\n"));
  const [ignoreTextPatterns, setIgnoreTextPatterns] = useState((s?.ignoreTextPatterns ?? []).join("\n"));
  const [builtInNoiseFilters, setBuiltInNoiseFilters] = useState(s?.builtInNoiseFilters ?? true);
  const [ignoreSliders, setIgnoreSliders] = useState(s?.ignoreSliders ?? false);
  const [ignoreRelatedContent, setIgnoreRelatedContent] = useState(s?.ignoreRelatedContent ?? true);
  const [skipPaginatedListings, setSkipPaginatedListings] = useState(s?.skipPaginatedListings ?? true);

  // Access
  const [access, setAccess] = useState<"public" | "login">(s?.auth ? "login" : "public");
  const [auth, setAuth] = useState({
    loginUrl: s?.auth?.loginUrl ?? "",
    usernameSelector: s?.auth?.usernameSelector ?? "input[type=email], input[name=username], input[name=email], #username",
    passwordSelector: s?.auth?.passwordSelector ?? "input[type=password]",
    submitSelector: s?.auth?.submitSelector ?? "button[type=submit], input[type=submit]",
    successSelector: s?.auth?.successSelector ?? "",
    failureUrlPattern: s?.auth?.failureUrlPattern ?? "",
  });
  const [username, setUsername] = useState(w?.credentialsUsername ?? "");
  const [password, setPassword] = useState("");
  const [removeCreds, setRemoveCreds] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!devices.length) return setError("Select at least one device.");
    const n = (v: string) => Number(v);
    if (scope === "limit" && !(n(maxPages) >= 1 && n(maxPages) <= WHOLE_SITE_PAGES)) return setError(`Number of pages must be between 1 and ${WHOLE_SITE_PAGES}.`);
    if (Object.values(speed).some((v) => v.trim() === "" || isNaN(n(v)) || n(v) < 0)) return setError("Crawl speed values must be positive numbers.");

    const body: Record<string, unknown> = {
      name,
      baseUrl,
      settings: {
        devices,
        maxPages: scope === "whole" ? WHOLE_SITE_PAGES : Math.round(n(maxPages)),
        maxDepth: scope === "whole" ? WHOLE_SITE_DEPTH : Math.round(n(speed.depth)),
        crawlDelayMs: Math.round(n(speed.delay) * 1000),
        pageTimeoutMs: Math.round(n(speed.timeout) * 1000),
        retries: Math.round(n(speed.retries)),
        waitAfterLoadMs: Math.round(n(speed.settle) * 1000),
        useSitemap,
        followLinks,
        checkLinks,
        includeUrls: lines(includeUrls),
        excludePatterns: lines(excludePatterns),
        ignoreSelectors: lines(ignoreSelectors),
        ignoreTextPatterns: lines(ignoreTextPatterns),
        builtInNoiseFilters,
        ignoreSliders,
        ignoreRelatedContent,
        skipPaginatedListings,
      },
      auth: access === "login" ? auth : null,
    };
    if (access === "public" || removeCreds) {
      if (w?.hasCredentials) body.credentials = null;
    } else if (password) {
      body.credentials = { username, password };
    } else if (!w?.hasCredentials) {
      return setError("Login-protected websites need a username and password.");
    }

    setSaving(true);
    const res = await fetch(mode.kind === "create" ? "/api/websites" : `/api/websites/${w!.id}`, {
      method: mode.kind === "create" ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) return setError(friendly(data.error ?? `Request failed (${res.status})`));
    router.push(`/websites/${data.website.id}`);
    router.refresh();
  }

  const speedField = (key: keyof typeof speed, label: string, hint: string, opts: { step?: string; disabled?: boolean; display?: string } = {}) => (
    <div>
      <label className="label whitespace-nowrap" htmlFor={`speed-${key}`} title={hint}>{label}</label>
      <input
        id={`speed-${key}`}
        className="input disabled:bg-gray-100 disabled:text-gray-500"
        type={opts.display ? "text" : "number"}
        min="0"
        step={opts.step ?? "1"}
        disabled={opts.disabled}
        value={opts.display ?? speed[key]}
        onChange={(e) => setSpeed({ ...speed, [key]: e.target.value })}
      />
      <p className="mt-1 text-xs text-gray-500">{hint}</p>
    </div>
  );
  const check = (label: string, value: boolean, set: (v: boolean) => void, hint?: string) => (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" className="mt-0.5" checked={value} onChange={(e) => set(e.target.checked)} />
      <span>{label}{hint && <span className="block text-xs text-gray-500">{hint}</span>}</span>
    </label>
  );

  return (
    <form onSubmit={submit} className="space-y-5">
      {/* 1. Website */}
      <section className="card space-y-4 p-5">
        <h2 className="flex items-center gap-2 font-semibold"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-indigo-500 to-violet-600 text-xs font-bold text-white shadow-sm">1</span>Website</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="name">Name</label>
            <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Company website" required />
          </div>
          <div>
            <label className="label" htmlFor="baseUrl">Website URL</label>
            <input id="baseUrl" className="input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://example.com" required />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-5">
          <span className="label mb-0">Check on</span>
          {[
            ["desktop", "Desktop"],
            ["mobile", "Mobile"],
          ].map(([d, label]) => (
            <label key={d} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name={`device-${d}`} checked={devices.includes(d)} onChange={(e) => setDevices(e.target.checked ? [...devices, d] : devices.filter((x) => x !== d))} />
              {label}
            </label>
          ))}
        </div>
      </section>

      {/* 2. Access */}
      <section className="card space-y-4 p-5">
        <h2 className="flex items-center gap-2 font-semibold"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-indigo-500 to-violet-600 text-xs font-bold text-white shadow-sm">2</span>Access</h2>
        <div className="flex flex-wrap gap-5 text-sm">
          <label className="flex items-center gap-2"><input type="radio" name="access" checked={access === "public"} onChange={() => setAccess("public")} /> Public website</label>
          <label className="flex items-center gap-2"><input type="radio" name="access" checked={access === "login"} onChange={() => setAccess("login")} /> Requires login</label>
        </div>
        {access === "login" && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className="label" htmlFor="loginUrl">Login page URL</label>
                <input id="loginUrl" className="input" value={auth.loginUrl} onChange={(e) => setAuth({ ...auth, loginUrl: e.target.value })} placeholder="https://example.com/login" required />
              </div>
              <div>
                <label className="label" htmlFor="username">Username</label>
                <input id="username" className="input" autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="password">Password</label>
                <input id="password" className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={w?.hasCredentials ? "•••••••• saved (leave blank to keep)" : ""} />
              </div>
            </div>
            <p className="text-xs text-gray-500">The password is stored encrypted and is never shown again or written to logs/reports.</p>
            {w?.hasCredentials && check("Remove saved login details", removeCreds, setRemoveCreds)}
            <details className="rounded-md border border-gray-200 p-3">
              <summary className="cursor-pointer text-sm text-gray-700">Login form not detected automatically? Set the field selectors</summary>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                {([
                  ["usernameSelector", "Username field"],
                  ["passwordSelector", "Password field"],
                  ["submitSelector", "Login button"],
                  ["successSelector", "Element visible after login (optional)"],
                  ["failureUrlPattern", "Login failed if URL contains (optional)"],
                ] as const).map(([k, label]) => (
                  <div key={k}>
                    <label className="label" htmlFor={k}>{label}</label>
                    <input id={k} className="input font-mono text-xs" value={auth[k]} onChange={(e) => setAuth({ ...auth, [k]: e.target.value })} />
                  </div>
                ))}
              </div>
            </details>
          </div>
        )}
      </section>

      {/* 3. Pages */}
      <section className="card space-y-4 p-5">
        <h2 className="flex items-center gap-2 font-semibold"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-indigo-500 to-violet-600 text-xs font-bold text-white shadow-sm">3</span>Pages to check</h2>
        <div className="space-y-2 text-sm">
          <label className="flex items-start gap-2">
            <input type="radio" name="scope" className="mt-1" checked={scope === "whole"} onChange={() => setScope("whole")} />
            <span>
              <strong>Whole website</strong>
              <span className="block text-xs text-gray-500">Finds and checks every page it can reach (up to {WHOLE_SITE_PAGES.toLocaleString()} pages). Large sites can take a long time.</span>
            </span>
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="scope" checked={scope === "limit"} onChange={() => setScope("limit")} />
            <strong>Limit to</strong>
            <input aria-label="Number of pages" className="input w-24 py-1" type="number" min="1" max={WHOLE_SITE_PAGES} value={maxPages} onFocus={() => setScope("limit")} onChange={(e) => setMaxPages(e.target.value)} />
            pages
          </label>
        </div>
        <div className="flex flex-wrap gap-x-8 gap-y-3 border-t border-gray-100 pt-4">
          {check("Use sitemap.xml", useSitemap, setUseSitemap, "Finds pages listed in the sitemap")}
          {check("Follow links", followLinks, setFollowLinks, "Finds pages linked from other pages")}
          {check("Report broken links", checkLinks, setCheckLinks, "Checks links on each page for errors")}
          {check("Skip extra listing pages", skipPaginatedListings, setSkipPaginatedListings, "Page 2, 3 … of blogs, categories and shops")}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="includeUrls">Always include these pages (optional)</label>
            <textarea id="includeUrls" className="input font-mono text-xs" rows={3} value={includeUrls} onChange={(e) => setIncludeUrls(e.target.value)} placeholder={"/checkout\n/landing/summer-sale"} />
            <p className="mt-1 text-xs text-gray-500">One per line. Pages that are not linked anywhere.</p>
          </div>
          <div>
            <label className="label" htmlFor="excludePatterns">Never check these pages (optional)</label>
            <textarea id="excludePatterns" className="input font-mono text-xs" rows={3} value={excludePatterns} onChange={(e) => setExcludePatterns(e.target.value)} placeholder={"*/logout*\n*/cart*"} />
            <p className="mt-1 text-xs text-gray-500">One per line. Use * as a wildcard.</p>
          </div>
        </div>
      </section>

      {/* 4. Speed */}
      <section className="card space-y-4 p-5">
        <div>
          <h2 className="flex items-center gap-2 font-semibold"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-indigo-500 to-violet-600 text-xs font-bold text-white shadow-sm">4</span>Crawl speed</h2>
          <p className="text-xs text-gray-500">The defaults work for most websites.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {speedField("depth", "Link depth", "Clicks away from home page", scope === "whole" ? { disabled: true, display: "All" } : {})}
          {speedField("delay", "Delay (sec)", "Pause between pages", { step: "0.1" })}
          {speedField("timeout", "Timeout (sec)", "Max wait for a page to load", { step: "1" })}
          {speedField("retries", "Retries", "Extra tries if a page fails")}
          {speedField("settle", "Settle wait (sec)", "Wait for late content", { step: "0.05" })}
        </div>
      </section>

      {/* 5. Optional ignore rules */}
      <details className="card p-5" open>
        <summary className="cursor-pointer font-semibold">
          <span className="inline-flex items-center gap-2"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-indigo-500 to-violet-600 text-xs font-bold text-white shadow-sm">5</span>Ignore changing content</span> <span className="font-normal text-gray-500">(optional)</span>
          <span className="block text-xs font-normal text-gray-500">Use this if parts of the site change on every visit (chat widgets, carousels, live counters) and keep showing up as changes.</span>
        </summary>
        <div className="mt-4 space-y-3">
          {check("Dates, times, ads, cookie banners and animations (recommended)", builtInNoiseFilters, setBuiltInNoiseFilters)}
          {check("Random “related products / related posts” blocks (recommended)", ignoreRelatedContent, setIgnoreRelatedContent, "Shop and blog widgets that show different items on every visit")}
          {check("Image sliders & carousels", ignoreSliders, setIgnoreSliders, "Sliders are already stopped on their first slide before each screenshot. Tick this only if a slider still shows up as a change – the whole slider is then ignored.")}
        </div>
        <p className="mt-4 text-xs font-semibold tracking-wide text-slate-600 uppercase">Anything else (optional)</p>
        <div className="mt-2 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="ignoreSelectors">Ignore these elements</label>
            <textarea id="ignoreSelectors" className="input font-mono text-xs" rows={3} value={ignoreSelectors} onChange={(e) => setIgnoreSelectors(e.target.value)} placeholder={".live-chat\n#news-ticker"} />
            <p className="mt-1 text-xs text-gray-500">CSS selectors, one per line.</p>
          </div>
          <div>
            <label className="label" htmlFor="ignoreTextPatterns">Ignore this text</label>
            <textarea id="ignoreTextPatterns" className="input font-mono text-xs" rows={3} value={ignoreTextPatterns} onChange={(e) => setIgnoreTextPatterns(e.target.value)} placeholder={"Visitors today: *"} />
            <p className="mt-1 text-xs text-gray-500">One per line. Use * as a wildcard.</p>
          </div>
        </div>
      </details>

      {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}
      <div className="flex gap-2">
        <button className="btn-primary" disabled={saving}>{saving ? "Saving…" : mode.kind === "create" ? "Create website" : "Save settings"}</button>
        <button type="button" className="btn" onClick={() => router.back()}>Cancel</button>
      </div>
    </form>
  );
}

/** Turns validation messages like "settings.pageTimeoutMs: Too small…" into plain language. */
function friendly(msg: string): string {
  return msg
    .replace(/settings\.pageTimeoutMs[^;]*/g, "Timeout must be between 5 and 180 seconds")
    .replace(/settings\.crawlDelayMs[^;]*/g, "Delay must be at most 60 seconds")
    .replace(/settings\.waitAfterLoadMs[^;]*/g, "Settle wait must be at most 30 seconds")
    .replace(/settings\.retries[^;]*/g, "Retries must be between 0 and 5")
    .replace(/settings\.maxDepth[^;]*/g, "Link depth must be between 0 and 10");
}
