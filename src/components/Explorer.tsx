"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CrawlRun, Device, PageCapture, PageData } from "@core/types";
import RegionPreview from "./RegionPreview";
import JobProgress from "./JobProgress";
import { SeverityBadge, StatusBadge } from "./ui";
import { fileUrl, fmtDate, shortUrl } from "@/lib/format";

interface WebsiteOpt {
  id: number;
  name: string;
  baseUrl: string;
  activeBaselineId: number | null;
}
interface PageDetail {
  page: PageCapture;
  run: CrawlRun;
  data: PageData | null;
  linkChecks: Record<string, { status: number | null; ok: boolean; error: string | null }>;
}
interface ManualChange {
  category: string;
  changeType: string;
  severity: string;
  description: string;
  expected: string | null;
  actual: string | null;
  selector: string | null;
  evidence?: { baselineCrop?: string; currentCrop?: string; diffImage?: string | null; details?: string[] };
}
interface ManualResult {
  a: PageCapture;
  b: PageCapture;
  changes: ManualChange[];
  visual: { diffPercent: number; diffKey: string | null } | null;
  note: string | null;
}

const TABS = ["Screenshots", "Sections", "Content", "Images", "Links", "Metadata", "DOM"] as const;
type Tab = (typeof TABS)[number];

const runLabel = (r: CrawlRun) =>
  r.kind === "baseline"
    ? `Baseline v${r.version}${r.label && r.label !== `Baseline v${r.version}` ? ` – ${r.label}` : ""} · ${fmtDate(r.createdAt)}`
    : `${r.kind === "comparison" ? "Comparison crawl" : "Manual capture"} #${r.id} · ${fmtDate(r.createdAt)}`;

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
  return d as T;
}

export default function Explorer({
  websites,
  initial,
}: {
  websites: WebsiteOpt[];
  initial: { websiteId: number | null; runId: number | null; urlKey: string | null; device: Device; compareRunId: number | null };
}) {
  const [websiteId, setWebsiteId] = useState<number | null>(initial.websiteId);
  const [runs, setRuns] = useState<CrawlRun[]>([]);
  const [runId, setRunId] = useState<number | null>(initial.runId);
  const [pages, setPages] = useState<PageCapture[]>([]);
  const [urlKey, setUrlKey] = useState<string | null>(initial.urlKey);
  const [device, setDevice] = useState<Device>(initial.device);
  const [detail, setDetail] = useState<PageDetail | null>(null);
  const [tab, setTab] = useState<Tab>("Screenshots");
  const [compareRunId, setCompareRunId] = useState<number | null>(initial.compareRunId);
  const [comparePages, setComparePages] = useState<PageCapture[]>([]);
  const [manual, setManual] = useState<ManualResult | null>(null);
  const [manualLoading, setManualLoading] = useState(false);
  const [captureJob, setCaptureJob] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const website = websites.find((w) => w.id === websiteId) ?? null;
  const usableRuns = runs.filter((r) => r.status === "completed" || r.status === "partial" || r.status === "failed");

  // Website -> runs
  const loadRuns = useCallback(
    async (wid: number, preferRun?: number | null) => {
      const d = await getJson<{ runs: CrawlRun[]; website: { activeBaselineId: number | null } }>(`/api/websites/${wid}`);
      setRuns(d.runs);
      const ok = d.runs.filter((r) => r.status !== "queued" && r.status !== "running");
      const pick = (preferRun && ok.find((r) => r.id === preferRun)) || ok.find((r) => r.id === d.website.activeBaselineId) || ok.find((r) => r.kind === "baseline") || ok[0];
      setRunId(pick?.id ?? null);
      return d.runs;
    },
    [],
  );
  useEffect(() => {
    if (!websiteId) return;
    setError(null);
    loadRuns(websiteId, runId).catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [websiteId]);

  // Run -> pages
  useEffect(() => {
    if (!runId) {
      setPages([]);
      return;
    }
    let current = true;
    getJson<{ pages: PageCapture[] }>(`/api/runs/${runId}/pages`)
      .then((d) => {
        if (!current) return;
        setPages(d.pages);
        setUrlKey((cur) => (cur && d.pages.some((p) => p.urlKey === cur) ? cur : d.pages.find((p) => new URL(p.urlKey).pathname === "/")?.urlKey ?? d.pages[0]?.urlKey ?? null));
        const devs = new Set(d.pages.map((p) => p.device));
        setDevice((cur) => (devs.has(cur) ? cur : ((devs.values().next().value as Device) ?? "desktop")));
      })
      .catch((e) => current && setError(e.message));
    return () => {
      current = false;
    };
  }, [runId]);

  const page = pages.find((p) => p.urlKey === urlKey && p.device === device) ?? null;

  // Page -> detail
  useEffect(() => {
    setDetail(null);
    if (!page) return;
    let current = true; // ignore responses for a page that is no longer selected
    getJson<PageDetail>(`/api/pages/${page.id}`)
      .then((d) => current && setDetail(d))
      .catch((e) => current && setError(e.message));
    return () => {
      current = false;
    };
  }, [page?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Compare run -> pages
  useEffect(() => {
    setComparePages([]);
    setManual(null);
    if (!compareRunId) return;
    let current = true;
    getJson<{ pages: PageCapture[] }>(`/api/runs/${compareRunId}/pages`)
      .then((d) => current && setComparePages(d.pages))
      .catch((e) => current && setError(e.message));
    return () => {
      current = false;
    };
  }, [compareRunId]);
  const comparePage = comparePages.find((p) => p.urlKey === urlKey && p.device === device) ?? null;

  // Manual comparison
  useEffect(() => {
    setManual(null);
    if (!page || !comparePage) return;
    let current = true; // a slower, older comparison must not overwrite the current one
    setManualLoading(true);
    getJson<ManualResult>(`/api/explorer/compare?a=${page.id}&b=${comparePage.id}`)
      .then((d) => current && setManual(d))
      .catch((e) => current && setError(e.message))
      .finally(() => current && setManualLoading(false));
    return () => {
      current = false;
    };
  }, [page?.id, comparePage?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep URL shareable
  useEffect(() => {
    const q = new URLSearchParams();
    if (websiteId) q.set("website", String(websiteId));
    if (runId) q.set("run", String(runId));
    if (urlKey) q.set("url", urlKey);
    q.set("device", device);
    if (compareRunId) q.set("compare", String(compareRunId));
    window.history.replaceState(null, "", `/explorer?${q}`);
  }, [websiteId, runId, urlKey, device, compareRunId]);

  const urls = useMemo(() => {
    const m = new Map<string, { urlKey: string; title: string | null; statuses: string[] }>();
    for (const p of pages) {
      const e = m.get(p.urlKey) ?? { urlKey: p.urlKey, title: p.title, statuses: [] };
      e.statuses.push(p.status);
      e.title ??= p.title;
      m.set(p.urlKey, e);
    }
    return [...m.values()].filter((u) => !filter || u.urlKey.toLowerCase().includes(filter.toLowerCase()) || (u.title ?? "").toLowerCase().includes(filter.toLowerCase()));
  }, [pages, filter]);
  const devices = useMemo(() => [...new Set(pages.map((p) => p.device))], [pages]);

  async function captureNow() {
    if (!websiteId || !urlKey) return;
    setError(null);
    const r = await fetch(`/api/websites/${websiteId}/capture`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ urls: [urlKey] }) });
    const d = await r.json();
    if (!r.ok) return setError(d.error);
    setCaptureJob(d.job.id);
  }

  // When a manual capture finishes, select its run for comparison.
  useEffect(() => {
    if (!captureJob) return;
    let alive = true;
    const t = setInterval(async () => {
      const d = await getJson<{ job: { status: string; result: { runId?: number } | null } }>(`/api/jobs/${captureJob}`).catch(() => null);
      if (!alive || !d) return;
      if (d.job.status === "completed" && d.job.result?.runId) {
        clearInterval(t);
        await loadRuns(websiteId!, runId);
        setCompareRunId(d.job.result.runId);
      } else if (d.job.status === "failed" || d.job.status === "cancelled") clearInterval(t);
    }, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [captureJob]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!websites.length) return <div className="card p-6 text-sm text-gray-600">No websites yet. Add one and save a baseline first.</div>;

  return (
    <div className="space-y-4">
      {/* Selection bar */}
      <div className="card grid gap-3 p-4 md:grid-cols-[1fr_2fr_auto]">
        <div>
          <label className="label" htmlFor="ex-website">Website</label>
          <select id="ex-website" className="input" value={websiteId ?? ""} onChange={(e) => { setWebsiteId(Number(e.target.value)); setRunId(null); setCompareRunId(null); setUrlKey(null); }}>
            {websites.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="ex-run">Baseline version / capture</label>
          <select id="ex-run" className="input" value={runId ?? ""} onChange={(e) => setRunId(Number(e.target.value))}>
            {!usableRuns.length && <option value="">No stored captures yet</option>}
            <optgroup label="Baselines">
              {usableRuns.filter((r) => r.kind === "baseline").map((r) => (
                <option key={r.id} value={r.id}>{runLabel(r)}{r.id === website?.activeBaselineId ? " (active)" : ""}{r.status !== "completed" ? ` [${r.status}]` : ""}</option>
              ))}
            </optgroup>
            <optgroup label="Comparison crawls & manual captures">
              {usableRuns.filter((r) => r.kind !== "baseline").map((r) => <option key={r.id} value={r.id}>{runLabel(r)}</option>)}
            </optgroup>
          </select>
        </div>
        <div>
          <span className="label">Device</span>
          <div className="flex overflow-hidden rounded-md border border-gray-300" role="group" aria-label="Device">
            {(["desktop", "mobile"] as Device[]).map((d) => (
              <button key={d} type="button" disabled={!devices.includes(d)} onClick={() => setDevice(d)}
                className={`px-3 py-1.5 text-sm ${device === d ? "bg-blue-600 text-white" : "bg-white text-gray-700 hover:bg-gray-50"} disabled:opacity-40`}>
                {d}
              </button>
            ))}
          </div>
        </div>
      </div>
      {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        {/* Page list */}
        <div className="card flex max-h-[75vh] flex-col">
          <div className="border-b border-gray-100 p-2">
            <input className="input" placeholder={`Filter ${urls.length} page(s)…`} value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          <ul className="flex-1 overflow-auto text-sm" aria-label="Captured pages">
            {urls.map((u) => (
              <li key={u.urlKey}>
                <button type="button" onClick={() => setUrlKey(u.urlKey)}
                  className={`block w-full border-b border-gray-50 px-3 py-2 text-left hover:bg-gray-50 ${u.urlKey === urlKey ? "bg-blue-50" : ""}`}>
                  <div className="truncate font-medium text-gray-800">{shortUrl(u.urlKey, website?.baseUrl)}</div>
                  <div className="flex items-center gap-1 truncate text-xs text-gray-500">
                    {u.statuses.some((s) => s !== "captured") && <span className="text-red-600">●</span>}
                    {u.title ?? "—"}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* Page detail */}
        <div className="min-w-0 space-y-4">
          {!page && <div className="card p-6 text-sm text-gray-500">{pages.length ? "Select a page (this page was not captured for this device)." : "Select a stored capture."}</div>}
          {page && (
            <div className="card p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
                <a href={page.url} target="_blank" rel="noreferrer" className="font-medium break-all text-blue-700 hover:underline">{page.url}</a>
                <StatusBadge status={page.status} />
                {page.httpStatus && <span className="text-gray-500">HTTP {page.httpStatus}</span>}
                <span className="text-gray-500">· {page.device} · captured {fmtDate(page.capturedAt)}</span>
              </div>
              {page.error && <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-sm text-amber-900">{page.error}</div>}
              <div className="mb-3 flex flex-wrap gap-1 border-b border-gray-200" role="tablist">
                {TABS.map((t) => (
                  <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
                    className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${tab === t ? "border-blue-600 font-medium text-blue-700" : "border-transparent text-gray-600 hover:text-gray-900"}`}>
                    {t}
                  </button>
                ))}
              </div>
              {!detail ? <div className="text-sm text-gray-500">Loading…</div> : <TabContent tab={tab} detail={detail} />}
            </div>
          )}

          {/* Manual comparison */}
          {page && (
            <div className="card p-4">
              <h2 className="mb-2 font-semibold">Manual comparison</h2>
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-64 flex-1">
                  <label className="label" htmlFor="ex-compare">Compare this page with</label>
                  <select id="ex-compare" className="input" value={compareRunId ?? ""} onChange={(e) => setCompareRunId(e.target.value ? Number(e.target.value) : null)}>
                    <option value="">— select another capture —</option>
                    {usableRuns.filter((r) => r.id !== runId).map((r) => <option key={r.id} value={r.id}>{runLabel(r)}</option>)}
                  </select>
                </div>
                <button className="btn" onClick={captureNow} disabled={!!captureJob && !manual}>Capture current version now</button>
              </div>
              {captureJob && !manual && <div className="mt-3"><JobProgress jobId={captureJob} refreshOnDone={false} /></div>}
              {compareRunId && !comparePage && comparePages.length > 0 && (
                <p className="mt-3 text-sm text-amber-800">This URL was not captured for {device} in the selected run.</p>
              )}
              {manualLoading && <p className="mt-3 text-sm text-gray-500">Comparing stored captures…</p>}
              {manual && <ManualCompare result={manual} />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TabContent({ tab, detail }: { tab: Tab; detail: PageDetail }) {
  const { page, data } = detail;
  const shot = fileUrl(page.screenshotPath);
  const W = page.screenshotWidth ?? 1440;
  const [zoom, setZoom] = useState<"fit" | "full">("fit");
  const [dom, setDom] = useState<string | null>(null);

  if (tab === "Screenshots") {
    if (!shot) return <p className="text-sm text-gray-500">No screenshot stored (capture failed).</p>;
    return (
      <div>
        <div className="mb-2 flex gap-2 text-xs">
          <button className="btn py-0.5 text-xs" onClick={() => setZoom(zoom === "fit" ? "full" : "fit")}>{zoom === "fit" ? "Actual size" : "Fit width"}</button>
          <a className="btn py-0.5 text-xs" href={shot} target="_blank" rel="noreferrer">Open image</a>
          <span className="self-center text-gray-500">{page.screenshotWidth}×{page.screenshotHeight}px</span>
        </div>
        <div className="max-h-[70vh] overflow-auto rounded border border-gray-200 bg-gray-100">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={shot} alt={`Screenshot of ${page.url} (${page.device})`} style={zoom === "fit" ? { width: page.device === "mobile" ? Math.min(W, 390) : "100%" } : { maxWidth: "none" }} />
        </div>
      </div>
    );
  }
  if (!data) return <p className="text-sm text-gray-500">No extracted data stored for this capture.</p>;

  if (tab === "Sections")
    return (
      <div className="space-y-3">
        {data.sections.length === 0 && <p className="text-sm text-gray-500">No sections detected.</p>}
        {data.sections.map((s, i) => (
          <div key={i} className="flex flex-wrap gap-4 border-b border-gray-100 pb-3">
            {shot && <RegionPreview src={shot} imageWidth={W} box={s.box ?? [0, s.top, W, s.height]} maxWidth={320} maxHeight={200} />}
            <div className="min-w-0 flex-1 text-sm">
              <div className="font-mono text-xs text-gray-700">&lt;{s.tag}{s.id && ` id="${s.id}"`}{s.classes && ` class="${s.classes}"`}{s.role && ` role="${s.role}"`}&gt;</div>
              {s.heading && <div className="mt-1 font-medium">{s.heading}</div>}
              <div className="mt-1 text-gray-600">{s.textSample}</div>
              <div className="mt-1 text-xs text-gray-400">y={s.top}px · height {s.height}px · {s.textLength} chars · {s.selector}</div>
            </div>
          </div>
        ))}
      </div>
    );

  if (tab === "Content")
    return (
      <div className="grid gap-6 xl:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-semibold">Headings ({data.headings.length})</h3>
          <ul className="space-y-1 text-sm">
            {data.headings.map((h, i) => (
              <li key={i} style={{ paddingLeft: (h.level - 1) * 14 }}><span className="mr-1.5 rounded bg-gray-100 px-1 font-mono text-xs text-gray-600">H{h.level}</span>{h.text}</li>
            ))}
          </ul>
          <h3 className="mt-5 mb-2 text-sm font-semibold">Buttons / CTAs ({data.buttons.length})</h3>
          <ul className="space-y-1 text-sm">
            {data.buttons.map((b, i) => <li key={i}><span className="rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-blue-800">{b.text}</span> {b.href && <span className="text-xs break-all text-gray-500">→ {b.href}</span>}</li>)}
          </ul>
          {data.forms.length > 0 && (
            <>
              <h3 className="mt-5 mb-2 text-sm font-semibold">Forms ({data.forms.length})</h3>
              {data.forms.map((f, i) => (
                <div key={i} className="mb-2 text-sm"><span className="font-mono text-xs">{f.method.toUpperCase()} {f.action || "(same page)"}</span>
                  <div className="text-xs text-gray-600">{f.fields.map((x) => `${x.label || x.name} [${x.type}]`).join(" · ")}</div></div>
              ))}
            </>
          )}
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold">Text blocks ({data.textBlocks.length})</h3>
          <ol className="max-h-[60vh] space-y-1.5 overflow-auto text-sm">
            {data.textBlocks.map((t, i) => <li key={i} className="border-l-2 border-gray-200 pl-2"><span className="mr-1 font-mono text-xs text-gray-400">{t.tag}</span>{t.text}</li>)}
          </ol>
        </div>
      </div>
    );

  if (tab === "Images")
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {data.images.length === 0 && <p className="text-sm text-gray-500">No images.</p>}
        {data.images.map((img, i) => {
          const check = detail.linkChecks[img.src];
          return (
            <div key={i} className="rounded border border-gray-200 p-2 text-xs">
              {shot && img.box && img.box[2] > 0 ? <RegionPreview src={shot} imageWidth={W} box={img.box} maxWidth={260} maxHeight={160} /> : <div className="text-gray-400">not visible in screenshot</div>}
              <div className="mt-1 break-all text-gray-700">{img.src}</div>
              <div className="text-gray-500">alt: {img.alt || <em>(empty)</em>} · {img.naturalWidth}×{img.naturalHeight} · rendered {img.width}×{img.height}</div>
              <div>{img.loaded ? <span className="text-green-700">loaded</span> : <span className="text-red-700">not rendered{check ? ` – HTTP ${check.status ?? check.error}` : ""}</span>}</div>
            </div>
          );
        })}
      </div>
    );

  if (tab === "Links")
    return (
      <div className="max-h-[70vh] overflow-auto">
        <table className="tbl">
          <thead><tr><th>Text</th><th>URL</th><th>Check</th></tr></thead>
          <tbody>
            {data.links.map((l, i) => {
              const c = detail.linkChecks[l.href];
              return (
                <tr key={i}>
                  <td className="max-w-xs">{l.text || <em className="text-gray-400">(no text)</em>}</td>
                  <td className="break-all text-gray-600">{l.href}{l.target === "_blank" && <span className="ml-1 text-xs text-gray-400">(new tab)</span>}</td>
                  <td className="whitespace-nowrap">{c ? (c.ok ? <span className="text-green-700">{c.status}</span> : <span className="font-medium text-red-700">{c.status ?? c.error}</span>) : <span className="text-gray-400">not checked</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );

  if (tab === "Metadata") {
    const rows: [string, React.ReactNode][] = [
      ["Title", data.title],
      ["Meta description", data.meta.description],
      ["Canonical", data.meta.canonical],
      ["Robots", data.meta.robots],
      ["Keywords", data.meta.keywords],
      ["Viewport", data.meta.viewport],
      ["Language", data.lang],
      ["Requested URL", page.url],
      ["Final URL", page.finalUrl],
      ["HTTP status", page.httpStatus],
      ["Load time", page.loadMs ? `${page.loadMs} ms` : "—"],
      ["Layout", `${data.layout.scrollWidth}×${data.layout.scrollHeight}px on ${data.layout.viewportWidth}×${data.layout.viewportHeight} viewport${data.layout.horizontalOverflow ? " — HORIZONTAL OVERFLOW" : ""}`],
      ...Object.entries(data.meta.og).map(([k, v]) => [k, v] as [string, string]),
      ...Object.entries(data.meta.twitter).map(([k, v]) => [k, v] as [string, string]),
      ["Iframes", data.iframes.join("\n") || "—"],
    ];
    return (
      <table className="tbl">
        <tbody>{rows.map(([k, v]) => <tr key={k}><th className="w-48 normal-case">{k}</th><td className="break-all whitespace-pre-wrap">{v || <span className="text-gray-400">—</span>}</td></tr>)}</tbody>
      </table>
    );
  }

  // DOM
  return (
    <div className="space-y-3">
      <div className="text-sm text-gray-600">
        {data.domStats.elementCount} elements · max depth {data.domStats.maxDepth} ·{" "}
        {Object.entries(data.domStats.tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([t, n]) => `${t}:${n}`).join(" ")}
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        <div>
          <h3 className="mb-1 text-sm font-semibold">Structure outline</h3>
          <pre className="max-h-[60vh] overflow-auto rounded bg-gray-50 p-2 text-xs leading-snug">{data.outline.join("\n")}</pre>
        </div>
        <div>
          <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">Stored HTML snapshot
            {page.domPath && <a className="text-xs font-normal text-blue-700 hover:underline" href={`${fileUrl(page.domPath)}?download=1`}>download</a>}
          </h3>
          {dom === null ? (
            <button className="btn text-xs" disabled={!page.domPath} onClick={async () => setDom(await (await fetch(fileUrl(page.domPath)!)).text())}>Load HTML</button>
          ) : (
            <pre className="max-h-[60vh] overflow-auto rounded bg-gray-900 p-2 text-xs leading-snug whitespace-pre-wrap text-gray-100">{dom.slice(0, 400_000)}</pre>
          )}
        </div>
      </div>
    </div>
  );
}

function ManualCompare({ result }: { result: ManualResult }) {
  const [view, setView] = useState<"side" | "diff">("side");
  const a = fileUrl(result.a.screenshotPath);
  const b = fileUrl(result.b.screenshotPath);
  const diff = fileUrl(result.visual?.diffKey);
  const syncScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const other = (e.currentTarget.dataset.side === "a" ? document.getElementById("mc-b") : document.getElementById("mc-a")) as HTMLDivElement | null;
    if (other && Math.abs(other.scrollTop - e.currentTarget.scrollTop) > 2) other.scrollTop = e.currentTarget.scrollTop;
  };
  return (
    <div className="mt-4 space-y-4">
      {result.note && <p className="text-sm text-amber-800">{result.note}</p>}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <strong>{result.changes.length} difference(s)</strong>
        {result.visual && <span className="text-gray-600">Visual diff: {result.visual.diffPercent.toFixed(2)}% pixels</span>}
        <div className="ml-auto flex gap-1">
          <button className={view === "side" ? "btn-primary py-0.5 text-xs" : "btn py-0.5 text-xs"} onClick={() => setView("side")}>Side by side</button>
          <button className={view === "diff" ? "btn-primary py-0.5 text-xs" : "btn py-0.5 text-xs"} onClick={() => setView("diff")} disabled={!diff}>Diff overlay</button>
        </div>
      </div>
      {view === "side" ? (
        <div className="grid grid-cols-2 gap-2">
          {[["a", a, `Selected capture (${fmtDate(result.a.capturedAt)})`], ["b", b, `Compared capture (${fmtDate(result.b.capturedAt)})`]].map(([side, src, label]) => (
            <div key={side}>
              <div className="mb-1 text-xs font-semibold text-gray-600">{label}</div>
              <div id={`mc-${side}`} data-side={side} onScroll={syncScroll} className="max-h-[60vh] overflow-auto rounded border border-gray-200 bg-gray-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {src ? <img src={src} alt={label as string} className="w-full" /> : <div className="p-4 text-sm text-gray-500">No screenshot</div>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="max-h-[70vh] overflow-auto rounded border border-gray-200">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {diff && <img src={diff} alt="Pixel difference (red = changed)" className="w-full" />}
        </div>
      )}
      <ul className="divide-y divide-gray-100">
        {result.changes.map((c, i) => (
          <li key={i} className="py-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={c.severity} />
              <span className="badge bg-gray-100 text-gray-700">{c.category}</span>
              <span className="badge bg-gray-100 text-gray-700">{c.changeType.replace("_", " ")}</span>
              <span className="font-medium">{c.description}</span>
            </div>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              <div className="rounded bg-red-50 p-2"><div className="text-xs font-semibold text-red-800">Selected / expected</div><div className="wrap-break-word whitespace-pre-wrap">{c.expected ?? "—"}</div>
                {c.evidence?.baselineCrop && /* eslint-disable-next-line @next/next/no-img-element */ <img className="mt-2 max-h-48 rounded border" src={fileUrl(c.evidence.baselineCrop)!} alt="before" />}</div>
              <div className="rounded bg-green-50 p-2"><div className="text-xs font-semibold text-green-800">Compared / actual</div><div className="wrap-break-word whitespace-pre-wrap">{c.actual ?? "—"}</div>
                {c.evidence?.currentCrop && /* eslint-disable-next-line @next/next/no-img-element */ <img className="mt-2 max-h-48 rounded border" src={fileUrl(c.evidence.currentCrop)!} alt="after" />}</div>
            </div>
            {c.evidence?.details && c.evidence.details.length > 0 && (
              <details className="mt-1 text-xs text-gray-600"><summary className="cursor-pointer">Details</summary><pre className="whitespace-pre-wrap">{c.evidence.details.join("\n")}</pre></details>
            )}
          </li>
        ))}
        {result.changes.length === 0 && <li className="py-3 text-sm text-green-700">No differences detected between these two captures.</li>}
      </ul>
    </div>
  );
}
