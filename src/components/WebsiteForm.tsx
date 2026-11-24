"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Website } from "@core/types";

type Mode = { kind: "create" } | { kind: "edit"; website: Website };

const lines = (v: string) => v.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

export default function WebsiteForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const w = mode.kind === "edit" ? mode.website : null;
  const s = w?.settings;
  const [name, setName] = useState(w?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(w?.baseUrl ?? "");
  const [devices, setDevices] = useState<string[]>(s?.devices ?? ["desktop", "mobile"]);
  const [num, setNum] = useState({
    maxPages: s?.maxPages ?? 25,
    maxDepth: s?.maxDepth ?? 3,
    crawlDelayMs: s?.crawlDelayMs ?? 500,
    pageTimeoutMs: s?.pageTimeoutMs ?? 45000,
    retries: s?.retries ?? 2,
    waitAfterLoadMs: s?.waitAfterLoadMs ?? 750,
    visualThreshold: s?.visualThreshold ?? 0.1,
    visualMinDiffPercent: s?.visualMinDiffPercent ?? 0.3,
    maxScreenshotHeight: s?.maxScreenshotHeight ?? 12000,
    maxLinkChecks: s?.maxLinkChecks ?? 150,
  });
  const [flags, setFlags] = useState({
    useSitemap: s?.useSitemap ?? true,
    followLinks: s?.followLinks ?? true,
    builtInNoiseFilters: s?.builtInNoiseFilters ?? true,
    checkLinks: s?.checkLinks ?? true,
    checkExternalLinks: s?.checkExternalLinks ?? false,
  });
  const [lists, setLists] = useState({
    includeUrls: (s?.includeUrls ?? []).join("\n"),
    excludePatterns: (s?.excludePatterns ?? []).join("\n"),
    allowedDomains: (s?.allowedDomains ?? []).join("\n"),
    ignoreSelectors: (s?.ignoreSelectors ?? []).join("\n"),
    ignoreTextPatterns: (s?.ignoreTextPatterns ?? []).join("\n"),
  });
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
    setSaving(true);
    const body: Record<string, unknown> = {
      name,
      baseUrl,
      settings: {
        devices,
        ...Object.fromEntries(Object.entries(num).map(([k, v]) => [k, Number(v)])),
        ...flags,
        ...Object.fromEntries(Object.entries(lists).map(([k, v]) => [k, lines(v)])),
      },
      auth: access === "login" ? auth : null,
    };
    if (access === "public" || removeCreds) {
      if (w?.hasCredentials) body.credentials = null;
    } else if (password) {
      body.credentials = { username, password };
    } else if (!w?.hasCredentials) {
      setError("Login-protected websites need a username and password.");
      setSaving(false);
      return;
    }
    const res = await fetch(mode.kind === "create" ? "/api/websites" : `/api/websites/${w!.id}`, {
      method: mode.kind === "create" ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) return setError(data.error ?? `Request failed (${res.status})`);
    router.push(`/websites/${data.website.id}`);
    router.refresh();
  }

  const numField = (key: keyof typeof num, label: string, step = 1) => (
    <div>
      <label className="label" htmlFor={key}>{label}</label>
      <input id={key} className="input" type="number" step={step} value={num[key]} onChange={(e) => setNum({ ...num, [key]: e.target.value as any })} />
    </div>
  );
  const flag = (key: keyof typeof flags, label: string) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={flags[key]} onChange={(e) => setFlags({ ...flags, [key]: e.target.checked })} /> {label}
    </label>
  );
  const listField = (key: keyof typeof lists, label: string, hint: string) => (
    <div>
      <label className="label" htmlFor={key}>{label}</label>
      <textarea id={key} className="input font-mono text-xs" rows={3} value={lists[key]} onChange={(e) => setLists({ ...lists, [key]: e.target.value })} />
      <p className="mt-1 text-xs text-gray-500">{hint}</p>
    </div>
  );

  return (
    <form onSubmit={submit} className="space-y-5">
      <section className="card space-y-4 p-5">
        <h2 className="font-semibold">Website</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="name">Name</label>
            <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div>
            <label className="label" htmlFor="baseUrl">Base URL</label>
            <input id="baseUrl" className="input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://example.com" required />
          </div>
        </div>
        <div className="flex flex-wrap gap-5">
          <span className="label mb-0">Devices</span>
          {["desktop", "mobile"].map((d) => (
            <label key={d} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name={`device-${d}`}
                checked={devices.includes(d)}
                onChange={(e) => setDevices(e.target.checked ? [...devices, d] : devices.filter((x) => x !== d))}
              />
              {d}
            </label>
          ))}
        </div>
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="font-semibold">Access</h2>
        <div className="flex gap-5 text-sm">
          <label className="flex items-center gap-2"><input type="radio" name="access" checked={access === "public"} onChange={() => setAccess("public")} /> Public</label>
          <label className="flex items-center gap-2"><input type="radio" name="access" checked={access === "login"} onChange={() => setAccess("login")} /> Login-protected (form login)</label>
        </div>
        {access === "login" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="label" htmlFor="loginUrl">Login page URL</label>
              <input id="loginUrl" className="input" value={auth.loginUrl} onChange={(e) => setAuth({ ...auth, loginUrl: e.target.value })} placeholder="https://example.com/login" required />
            </div>
            <div>
              <label className="label" htmlFor="username">Username</label>
              <input id="username" className="input" autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="password">Password</label>
              <input
                id="password"
                className="input"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={w?.hasCredentials ? "•••••••• stored (leave blank to keep)" : ""}
              />
              <p className="mt-1 text-xs text-gray-500">Encrypted at rest (AES-256-GCM). Never shown again, never logged.</p>
            </div>
            <div>
              <label className="label">Username field selector</label>
              <input className="input font-mono text-xs" value={auth.usernameSelector} onChange={(e) => setAuth({ ...auth, usernameSelector: e.target.value })} />
            </div>
            <div>
              <label className="label">Password field selector</label>
              <input className="input font-mono text-xs" value={auth.passwordSelector} onChange={(e) => setAuth({ ...auth, passwordSelector: e.target.value })} />
            </div>
            <div>
              <label className="label">Submit button selector</label>
              <input className="input font-mono text-xs" value={auth.submitSelector} onChange={(e) => setAuth({ ...auth, submitSelector: e.target.value })} />
            </div>
            <div>
              <label className="label">Logged-in indicator selector (optional)</label>
              <input className="input font-mono text-xs" value={auth.successSelector} onChange={(e) => setAuth({ ...auth, successSelector: e.target.value })} placeholder="e.g. a[href='/logout']" />
            </div>
            <div>
              <label className="label">Login failed if URL matches (optional)</label>
              <input className="input font-mono text-xs" value={auth.failureUrlPattern} onChange={(e) => setAuth({ ...auth, failureUrlPattern: e.target.value })} placeholder="e.g. */login*" />
            </div>
            {w?.hasCredentials && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={removeCreds} onChange={(e) => setRemoveCreds(e.target.checked)} /> Remove stored credentials
              </label>
            )}
          </div>
        )}
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="font-semibold">Crawl settings</h2>
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {numField("maxPages", "Max pages")}
          {numField("maxDepth", "Max link depth")}
          {numField("crawlDelayMs", "Delay between pages (ms)")}
          {numField("pageTimeoutMs", "Page timeout (ms)")}
          {numField("retries", "Retries")}
          {numField("waitAfterLoadMs", "Settle wait (ms)")}
        </div>
        <div className="flex flex-wrap gap-5">
          {flag("useSitemap", "Discover via sitemap.xml")}
          {flag("followLinks", "Follow internal links")}
          {flag("checkLinks", "Check links for errors")}
          {flag("checkExternalLinks", "Also check external links")}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {listField("includeUrls", "Manual URLs (one per line)", "Always captured. Absolute or relative to base URL.")}
          {listField("excludePatterns", "Excluded URL patterns", "Use * wildcards or /regex/. e.g. */logout*, */cart*")}
          {listField("allowedDomains", "Extra internal domains", "Other domains/subdomains to treat as part of this site.")}
        </div>
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="font-semibold">Comparison & noise filtering</h2>
        <div className="grid gap-4 sm:grid-cols-4">
          {numField("visualThreshold", "Pixel colour threshold (0–1)", 0.01)}
          {numField("visualMinDiffPercent", "Min visual diff to report (%)", 0.05)}
          {numField("maxScreenshotHeight", "Max screenshot height (px)")}
          {numField("maxLinkChecks", "Max links checked")}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {listField("ignoreSelectors", "Ignored elements (CSS selectors)", "Hidden before screenshots and skipped in extraction, e.g. .live-chat, #ticker")}
          {listField("ignoreTextPatterns", "Ignored text patterns", "Removed before text comparison. * wildcard or /regex/gi")}
        </div>
        {flag("builtInNoiseFilters", "Built-in noise filters (dates/times, ads, cookie banners, animations)")}
      </section>

      {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}
      <div className="flex gap-2">
        <button className="btn-primary" disabled={saving}>{saving ? "Saving…" : mode.kind === "create" ? "Create website" : "Save settings"}</button>
        <button type="button" className="btn" onClick={() => router.back()}>Cancel</button>
      </div>
    </form>
  );
}
