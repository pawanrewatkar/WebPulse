"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Change, PageSummary } from "@core/types";
import { SeverityBadge, StatusBadge } from "./ui";
import { fileUrl, PAGE_STATUS_LABEL, shortUrl } from "@/lib/format";

const CATEGORIES = ["page", "visual", "content", "heading", "cta", "image", "link", "metadata", "section", "structure", "form", "responsive"];

export default function ComparisonView(props: {
  comparisonId: number;
  websiteId: number;
  baselineRunId: number;
  currentRunId: number;
  pages: PageSummary[];
  baseUrl: string;
}) {
  const [changes, setChanges] = useState<Change[]>([]);
  const [loading, setLoading] = useState(true);
  const [f, setF] = useState({ device: "", category: "", severity: "", review: "", url: "", includeIgnored: false });
  const [pageFilter, setPageFilter] = useState<"all" | "changed">("changed");

  const load = useCallback(async () => {
    setLoading(true);
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (v && k !== "includeIgnored") q.set(k, String(v));
    if (f.includeIgnored) q.set("includeIgnored", "1");
    const r = await fetch(`/api/comparisons/${props.comparisonId}/changes?${q}`, { cache: "no-store" });
    const d = await r.json();
    setChanges(d.changes ?? []);
    setLoading(false);
  }, [f, props.comparisonId]);
  useEffect(() => {
    load();
  }, [load]);

  const grouped = useMemo(() => {
    const m = new Map<string, Change[]>();
    for (const c of changes) {
      const k = `${c.urlKey}|${c.device}`;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(c);
    }
    return [...m.entries()];
  }, [changes]);

  const review = async (c: Change, reviewStatus: Change["reviewStatus"], alwaysIgnore = false) => {
    const note = reviewStatus === "flagged" ? prompt("Note for this flag (optional):") ?? undefined : undefined;
    const r = await fetch(`/api/changes/${c.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reviewStatus, alwaysIgnore, note }) });
    if (r.ok) {
      const { change } = await r.json();
      setChanges((list) => list.map((x) => (x.id === change.id ? change : x)));
    }
  };

  const pages = props.pages.filter((p) => pageFilter === "all" || p.status !== "unchanged");
  const sel = (key: keyof typeof f, options: string[], label: string) => (
    <select aria-label={label} className="input w-auto" value={f[key] as string} onChange={(e) => setF({ ...f, [key]: e.target.value })}>
      <option value="">{label}: all</option>
      {options.map((o) => <option key={o} value={o}>{o.replace("_", " ")}</option>)}
    </select>
  );

  return (
    <div className="space-y-5">
      <section>
        <div className="mb-2 flex items-center gap-3">
          <h2 className="font-semibold">Page-wise summary</h2>
          <select aria-label="Pages shown" className="input w-auto py-1 text-xs" value={pageFilter} onChange={(e) => setPageFilter(e.target.value as "all" | "changed")}>
            <option value="changed">Changed / problem pages</option>
            <option value="all">All pages</option>
          </select>
        </div>
        <div className="card max-h-96 overflow-auto">
          <table className="tbl">
            <thead className="sticky top-0"><tr><th>Page</th><th>Device</th><th>Status</th><th>Changes</th><th>Severity</th><th>Visual diff</th><th></th></tr></thead>
            <tbody>
              {pages.map((p) => (
                <tr key={p.urlKey + p.device} className={f.url === p.urlKey && f.device === p.device ? "bg-blue-50" : ""}>
                  <td className="max-w-sm"><div className="truncate font-medium">{shortUrl(p.url, props.baseUrl)}</div><div className="truncate text-xs text-gray-500">{p.title}</div>{p.note && <div className="text-xs text-amber-800">{p.note}</div>}</td>
                  <td>{p.device}</td>
                  <td><StatusBadge status={p.status} label={PAGE_STATUS_LABEL[p.status]} /></td>
                  <td>{p.changeCount}</td>
                  <td className="space-x-1 whitespace-nowrap">{(["critical", "high", "medium", "low"] as const).map((s) => (p.bySeverity[s] ? <span key={s} className="text-xs"><SeverityBadge severity={s} /> {p.bySeverity[s]}</span> : null))}</td>
                  <td>{p.visualDiffPercent !== null ? `${p.visualDiffPercent.toFixed(2)}%` : "—"}</td>
                  <td className="space-x-1 whitespace-nowrap text-right">
                    {p.changeCount > 0 && <button className="btn py-0.5 text-xs" onClick={() => setF({ ...f, url: p.urlKey, device: p.device })}>Show</button>}
                    {p.baselinePageId && p.currentPageId && (
                      <Link className="btn py-0.5 text-xs" href={`/explorer?website=${props.websiteId}&run=${props.baselineRunId}&compare=${props.currentRunId}&url=${encodeURIComponent(p.urlKey)}&device=${p.device}`}>Side by side</Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Detected changes</h2>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {sel("device", ["desktop", "mobile"], "Device")}
          {sel("category", CATEGORIES, "Category")}
          {sel("severity", ["critical", "high", "medium", "low"], "Severity")}
          {sel("review", ["pending", "confirmed", "ignored", "flagged"], "Review")}
          <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={f.includeIgnored} onChange={(e) => setF({ ...f, includeIgnored: e.target.checked })} /> include ignored</label>
          {f.url && <button className="btn text-xs" onClick={() => setF({ ...f, url: "", device: "" })}>Page: {shortUrl(f.url, props.baseUrl)} ✕</button>}
          <span className="ml-auto text-sm text-gray-500">{loading ? "Loading…" : `${changes.length} change(s)`}</span>
        </div>
        {!loading && changes.length === 0 && <div className="card p-6 text-center text-sm text-gray-500">No changes match these filters.</div>}
        <div className="space-y-4">
          {grouped.map(([key, list]) => (
            <div key={key} className="card">
              <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-2 text-sm">
                <a href={list[0].url} target="_blank" rel="noreferrer" className="font-medium break-all text-blue-700 hover:underline">{list[0].url}</a>
                <span className="badge bg-gray-100 text-gray-700">{list[0].device}</span>
                <span className="text-gray-500">{list[0].pageTitle}</span>
              </div>
              <ul className="divide-y divide-gray-100">
                {list.map((c) => <ChangeItem key={c.id} c={c} onReview={review} />)}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function ChangeItem({ c, onReview }: { c: Change; onReview: (c: Change, s: Change["reviewStatus"], always?: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const ev = c.evidence;
  return (
    <li className={`px-4 py-3 text-sm ${c.reviewStatus === "ignored" ? "opacity-60" : ""}`} data-testid="change-item">
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={c.severity} />
        <span className="badge bg-gray-100 text-gray-700">{c.category}</span>
        <span className="badge bg-gray-100 text-gray-700">{c.changeType.replace("_", " ")}</span>
        <span className="font-medium">{c.description}</span>
        <span className="ml-auto flex items-center gap-1">
          <StatusBadge status={c.reviewStatus} />
          {c.autoIgnored && <span className="text-xs text-gray-500">(rule)</span>}
        </span>
      </div>
      {(c.expected || c.actual) && (
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          <div className="rounded bg-red-50 p-2"><div className="text-xs font-semibold text-red-800">Expected (baseline)</div><div className="max-h-40 overflow-auto wrap-break-word whitespace-pre-wrap">{c.expected ?? "—"}</div></div>
          <div className="rounded bg-green-50 p-2"><div className="text-xs font-semibold text-green-800">Actual (current)</div><div className="max-h-40 overflow-auto wrap-break-word whitespace-pre-wrap">{c.actual ?? "—"}</div></div>
        </div>
      )}
      {(ev.baselineCrop || ev.currentCrop) && (
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          {/* eslint-disable @next/next/no-img-element */}
          <div>{ev.baselineCrop && <img src={fileUrl(ev.baselineCrop)!} alt="Baseline evidence" className="max-h-56 rounded border border-gray-200" />}</div>
          <div>{ev.currentCrop && <img src={fileUrl(ev.currentCrop)!} alt="Current evidence" className="max-h-56 rounded border border-gray-200" />}</div>
          {/* eslint-enable @next/next/no-img-element */}
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        {c.selector && <code className="rounded bg-gray-100 px-1 text-gray-600">{c.selector}</code>}
        {ev.baselineScreenshot && <a className="text-blue-700 hover:underline" href={fileUrl(ev.baselineScreenshot)!} target="_blank" rel="noreferrer">baseline screenshot</a>}
        {ev.currentScreenshot && <a className="text-blue-700 hover:underline" href={fileUrl(ev.currentScreenshot)!} target="_blank" rel="noreferrer">current screenshot</a>}
        {ev.diffImage && <a className="text-blue-700 hover:underline" href={fileUrl(ev.diffImage)!} target="_blank" rel="noreferrer">diff image</a>}
        {ev.details?.length ? <button className="text-blue-700 hover:underline" onClick={() => setOpen(!open)}>{open ? "hide details" : "details"}</button> : null}
        {c.reviewNote && <span className="text-purple-800">Note: {c.reviewNote}</span>}
        <span className="ml-auto flex flex-wrap gap-1">
          <button className="btn py-0.5 text-xs" onClick={() => onReview(c, "confirmed")}>Confirm</button>
          <button className="btn py-0.5 text-xs" onClick={() => onReview(c, "ignored")}>Ignore</button>
          <button className="btn py-0.5 text-xs" title="Ignore this exact change in future comparisons too" onClick={() => onReview(c, "ignored", true)}>Always ignore</button>
          <button className="btn py-0.5 text-xs" onClick={() => onReview(c, "flagged")}>Flag</button>
          {c.reviewStatus !== "pending" && <button className="btn py-0.5 text-xs" onClick={() => onReview(c, "pending")}>Reset</button>}
        </span>
      </div>
      {open && ev.details && <pre className="mt-2 max-h-64 overflow-auto rounded bg-gray-50 p-2 text-xs">{ev.details.join("\n")}</pre>}
      {open && ev.diffImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={fileUrl(ev.diffImage)!} alt="Visual diff" className="mt-2 max-h-[600px] rounded border border-gray-200" />
      )}
    </li>
  );
}
