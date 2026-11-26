"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Change, PageSummary } from "@core/types";
import { SeverityBadge, StatusBadge } from "./ui";
import { fileUrl, PAGE_STATUS_LABEL, shortUrl } from "@/lib/format";
import { friendlyTitle, highlightColor, SEVERITY_MEANING, whatToDo } from "@core/reports/plain";
import HighlightShot, { type Box, type Mark } from "./Highlight";
import PaginatedTable, { PAGE_SIZE, Pager, usePage } from "./Paginated";

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

  const [changePage, setChangePage] = usePage(changes.length);
  useEffect(() => setChangePage(1), [f, setChangePage]); // new filter -> back to page 1
  const grouped = useMemo(() => {
    const m = new Map<string, Change[]>();
    for (const c of changes.slice((changePage - 1) * PAGE_SIZE, changePage * PAGE_SIZE)) {
      const k = `${c.urlKey}|${c.device}`;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(c);
    }
    return [...m.entries()];
  }, [changes, changePage]);
  const numberOf = new Map(changes.map((c, i) => [c.id, i + 1]));

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
        <PaginatedTable
          label="page views"
          headers={["Page", "Device", "Status", "Changes", "Severity", "Visual diff", ""]}
          rows={pages.map((p) => ({
            key: p.urlKey + p.device,
            className: f.url === p.urlKey && f.device === p.device ? "bg-blue-50" : "",
            cells: (
              <>
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
              </>
            ),
          }))}
          empty={<div className="p-2 text-center text-sm text-gray-500">No pages to show.</div>}
        />
      </section>

      <section>
        <h2 className="mb-1 font-semibold">Detected changes</h2>
        <p className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
          {(["critical", "high", "medium", "low"] as const).map((s) => (
            <span key={s} className="flex items-center gap-1"><SeverityBadge severity={s} /> {SEVERITY_MEANING[s].split(" – ")[1]}</span>
          ))}
          <span><span className="font-semibold text-red-600">Red box</span> = changed or missing · <span className="font-semibold text-green-600">Green box</span> = new</span>
        </p>
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
            <PageGroup key={key} list={list} numberOf={numberOf} onReview={review} websiteId={props.websiteId} baselineRunId={props.baselineRunId} />
          ))}
        </div>
        {changes.length > PAGE_SIZE && (
          <div className="card mt-4">
            <Pager page={changePage} total={changes.length} onChange={(p) => { setChangePage(p); window.scrollTo({ top: 0, behavior: "smooth" }); }} label="changes" />
          </div>
        )}
      </section>
    </div>
  );
}

type ReviewFn = (c: Change, s: Change["reviewStatus"], always?: boolean) => void;

const isLoadFailure = (c: Change) => c.category === "page" && /could not be loaded/.test(c.description);
const regionBoxes = (c: Change): Box[] => (c.evidence.regions ?? []).map((r) => [r.x, r.y, r.width, r.height] as Box);

/** All changes for one page + device, with an optional whole-page before | now overview. */
function PageGroup({ list, numberOf, onReview, websiteId, baselineRunId }: { list: Change[]; numberOf: Map<number, number>; onReview: ReviewFn; websiteId: number; baselineRunId: number }) {
  const [overview, setOverview] = useState(false);
  const first = list[0];
  const ev = first.evidence;
  const canOverview = !!(ev.baselineScreenshot || ev.currentScreenshot) && list.some((c) => c.evidence.beforeBox || c.evidence.afterBox || c.evidence.regions?.length);
  const jump = (id: number) => document.getElementById(`change-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  const beforeMarks: Mark[] = [];
  const afterMarks: Mark[] = [];
  for (const c of list) {
    const label = `#${numberOf.get(c.id) ?? ""}`;
    const color = highlightColor(c);
    if (c.category === "visual") for (const b of regionBoxes(c)) (beforeMarks.push({ box: b, color, label, onClick: () => jump(c.id) }), afterMarks.push({ box: b, color, label, onClick: () => jump(c.id) }));
    if (c.evidence.beforeBox && c.category !== "visual") beforeMarks.push({ box: c.evidence.beforeBox, color, label, onClick: () => jump(c.id) });
    if (c.evidence.afterBox && c.category !== "visual") afterMarks.push({ box: c.evidence.afterBox, color, label, onClick: () => jump(c.id) });
  }
  let pageName = first.pageTitle ?? "";
  try {
    if (!pageName) pageName = new URL(first.url).pathname;
  } catch {
    /* keep */
  }
  return (
    <div className="card">
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-3 text-sm">
        <div className="min-w-0">
          <div className="font-semibold text-slate-900">{pageName}</div>
          <a href={first.url} target="_blank" rel="noreferrer" className="text-xs break-all text-blue-700 hover:underline">{first.url}</a>
        </div>
        <span className="badge bg-gray-100 text-gray-700">{first.device}</span>
        <span className="text-xs text-slate-500">{list.length} change(s) shown</span>
        {canOverview && (
          <button type="button" className="btn ml-auto py-1 text-xs" onClick={() => setOverview(!overview)}>
            {overview ? "Hide whole page" : "Show whole page (before | now)"}
          </button>
        )}
      </div>
      {overview && (
        <div className="grid gap-3 border-b border-gray-100 p-4 md:grid-cols-2">
          <div>
            <div className="mb-1 text-xs font-semibold text-slate-600">Before (saved baseline) – click a box to jump to the change</div>
            {ev.baselineScreenshot ? <HighlightShot src={fileUrl(ev.baselineScreenshot)!} marks={beforeMarks} mode="full" alt="Whole page before" maxHeight={700} /> : <NoShot text="No baseline screenshot" />}
          </div>
          <div>
            <div className="mb-1 text-xs font-semibold text-slate-600">Now (latest check)</div>
            {ev.currentScreenshot ? <HighlightShot src={fileUrl(ev.currentScreenshot)!} marks={afterMarks} mode="full" alt="Whole page now" maxHeight={700} /> : <NoShot text="No current screenshot (the page could not be loaded)" />}
          </div>
        </div>
      )}
      <ul className="divide-y divide-gray-100">
        {list.map((c) => <ChangeItem key={c.id} c={c} no={numberOf.get(c.id) ?? 0} onReview={onReview} websiteId={websiteId} baselineRunId={baselineRunId} />)}
      </ul>
    </div>
  );
}

function NoShot({ text, children }: { text: string; children?: React.ReactNode }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-amber-300 bg-amber-50 p-4 text-center text-sm text-amber-900">
      <span>{text}</span>
      {children}
    </div>
  );
}

/** Before / now pictures for one change, with the changed area boxed. */
function ChangeVisual({ c, websiteId, baselineRunId }: { c: Change; websiteId: number; baselineRunId: number }) {
  const ev = c.evidence;
  const before = fileUrl(ev.baselineScreenshot);
  const now = fileUrl(ev.currentScreenshot);
  const color = highlightColor(c);

  if (isLoadFailure(c)) {
    return (
      <Pair
        left={before ? <HighlightShot src={before} marks={[]} mode="crop" alt="Page before" /> : <NoShot text="No baseline screenshot" />}
        right={
          <NoShot text="This page could not be loaded during the latest check, so there is no current picture.">
            <RetryPage c={c} websiteId={websiteId} baselineRunId={baselineRunId} />
          </NoShot>
        }
      />
    );
  }

  let bFocus: Box | null = null;
  let aFocus: Box | null = null;
  let bMarks: Mark[] = [];
  let aMarks: Mark[] = [];
  if (c.category === "visual") {
    const regions = regionBoxes(c);
    bFocus = aFocus = regions[0] ?? null;
    bMarks = aMarks = regions.map((box) => ({ box, color }));
  } else if (ev.beforeBox || ev.afterBox) {
    bFocus = ev.beforeBox ?? ev.afterBox ?? null; // show the same area if the element is missing on one side
    aFocus = ev.afterBox ?? ev.beforeBox ?? null;
    if (ev.beforeBox) bMarks = [{ box: ev.beforeBox, color, label: c.changeType === "removed" ? "missing now" : undefined }];
    if (ev.afterBox) aMarks = [{ box: ev.afterBox, color, label: c.changeType === "added" ? "new" : undefined }];
  } else if (ev.baselineCrop || ev.currentCrop) {
    // Older comparisons: pre-cut evidence images (no position information stored).
    return (
      <Pair
        left={ev.baselineCrop ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={fileUrl(ev.baselineCrop)!} alt="Before" className="max-h-72 rounded-lg border border-slate-200" /> : <NoShot text="Not on the page before" />}
        right={ev.currentCrop ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={fileUrl(ev.currentCrop)!} alt="Now" className="max-h-72 rounded-lg border border-slate-200" /> : <NoShot text="Not on the page now" />}
      />
    );
  } else if (c.category !== "page") {
    return null; // nothing visual to point at (e.g. metadata) – the Was / Now text explains it
  }
  return (
    <Pair
      left={
        // Something new (no position on the old page): the same coordinates there would show unrelated content.
        !before || (ev.afterBox && !ev.beforeBox && c.category !== "visual") ? <NoShot text="Not on the page before" /> : <HighlightShot src={before} marks={bMarks} mode="crop" focus={bFocus} alt="Before" />
      }
      right={now ? <HighlightShot src={now} marks={aMarks} mode="crop" focus={aFocus} alt="Now" /> : <NoShot text="No current picture" />}
    />
  );
}

function Pair({ left, right }: { left: React.ReactNode; right: React.ReactNode }) {
  return (
    <div className="mt-3 grid gap-3 md:grid-cols-2">
      <div>
        <div className="mb-1 text-xs font-semibold text-slate-600">Before (saved baseline)</div>
        {left}
      </div>
      <div>
        <div className="mb-1 text-xs font-semibold text-slate-600">Now (latest check)</div>
        {right}
      </div>
    </div>
  );
}

/** Re-checks a single page that failed to load and links to a side-by-side view when done. */
function RetryPage({ c, websiteId, baselineRunId }: { c: Change; websiteId: number; baselineRunId: number }) {
  const [state, setState] = useState<{ status: "idle" | "running" | "done" | "error"; msg?: string; runId?: number }>({ status: "idle" });
  async function retry() {
    setState({ status: "running", msg: "Checking the page again…" });
    const r = await fetch(`/api/websites/${websiteId}/capture`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ urls: [c.url], devices: [c.device] }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return setState({ status: "error", msg: d.error ?? "Could not start the check" });
    for (let i = 0; i < 200; i++) {
      await new Promise((res) => setTimeout(res, 2000));
      const j = await fetch(`/api/jobs/${d.job.id}`, { cache: "no-store" }).then((x) => x.json()).catch(() => null);
      const job = j?.job;
      if (!job) continue;
      if (job.status === "completed") return setState({ status: "done", runId: job.result?.runId, msg: job.message });
      if (job.status === "failed" || job.status === "cancelled") return setState({ status: "error", msg: job.error ?? "The check did not finish" });
    }
    setState({ status: "error", msg: "Still running – see the Jobs page" });
  }
  if (state.status === "done")
    return (
      <span className="space-y-1">
        <span className="block text-green-800">{state.msg}</span>
        <Link className="btn-primary text-xs" href={`/explorer?website=${websiteId}&run=${baselineRunId}&compare=${state.runId}&url=${encodeURIComponent(c.urlKey)}&device=${c.device}`}>Compare side by side →</Link>
      </span>
    );
  return (
    <span className="space-y-1">
      <button type="button" className="btn-primary text-xs" onClick={retry} disabled={state.status === "running"}>
        {state.status === "running" ? "Checking…" : "Retry this page"}
      </button>
      {state.msg && <span className={`block text-xs ${state.status === "error" ? "text-red-700" : "text-slate-600"}`}>{state.msg}</span>}
    </span>
  );
}

function ChangeItem({ c, no, onReview, websiteId, baselineRunId }: { c: Change; no: number; onReview: ReviewFn; websiteId: number; baselineRunId: number }) {
  const ev = c.evidence;
  return (
    <li id={`change-${c.id}`} className={`px-4 py-4 text-sm ${c.reviewStatus === "ignored" ? "opacity-60" : ""}`} data-testid="change-item">
      <div className="flex flex-wrap items-center gap-2">
        <span className="badge bg-indigo-100 font-semibold text-indigo-800 tabular-nums" title="Change number">#{no}</span>
        <span title={SEVERITY_MEANING[c.severity]}><SeverityBadge severity={c.severity} /></span>
        <span className="text-base font-semibold text-slate-900">{friendlyTitle(c)}</span>
        <span className="ml-auto flex items-center gap-1">
          <StatusBadge status={c.reviewStatus} />
          {c.autoIgnored && <span className="text-xs text-gray-500">(rule)</span>}
        </span>
      </div>
      <div className="mt-1 text-slate-600">{c.description}</div>

      <ChangeVisual c={c} websiteId={websiteId} baselineRunId={baselineRunId} />

      {(c.expected || c.actual) && !isLoadFailure(c) && (
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          <div className="rounded-lg bg-red-50 p-2"><div className="text-xs font-semibold text-red-800">Was (baseline)</div><div className="max-h-40 overflow-auto wrap-break-word whitespace-pre-wrap">{c.expected ?? "— (not there)"}</div></div>
          <div className="rounded-lg bg-green-50 p-2"><div className="text-xs font-semibold text-green-800">Now (current)</div><div className="max-h-40 overflow-auto wrap-break-word whitespace-pre-wrap">{c.actual ?? "— (not there anymore)"}</div></div>
        </div>
      )}

      <div className="mt-3 rounded-lg bg-sky-50 px-3 py-2 text-sky-900"><strong>What to do:</strong> {whatToDo(c)}</div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        {c.reviewNote && <span className="text-purple-800">Note: {c.reviewNote}</span>}
        <span className="ml-auto flex flex-wrap gap-1">
          <button className="btn py-0.5 text-xs" title="This change is real / expected" onClick={() => onReview(c, "confirmed")}>Confirm</button>
          <button className="btn py-0.5 text-xs" title="Not a problem – hide it in this comparison" onClick={() => onReview(c, "ignored")}>Ignore</button>
          <button className="btn py-0.5 text-xs" title="Ignore this exact change in future comparisons too" onClick={() => onReview(c, "ignored", true)}>Always ignore</button>
          <button className="btn py-0.5 text-xs" title="Needs attention – add a note" onClick={() => onReview(c, "flagged")}>Flag</button>
          {c.reviewStatus !== "pending" && <button className="btn py-0.5 text-xs" onClick={() => onReview(c, "pending")}>Reset</button>}
        </span>
      </div>

      <details className="mt-2 text-xs text-slate-600">
        <summary className="cursor-pointer select-none">Technical details</summary>
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap gap-2">
            <span className="badge bg-gray-100 text-gray-700">category: {c.category}</span>
            <span className="badge bg-gray-100 text-gray-700">type: {c.changeType.replace("_", " ")}</span>
            {c.selector && <code className="rounded bg-gray-100 px-1">{c.selector}</code>}
          </div>
          <div className="flex flex-wrap gap-3">
            {ev.baselineScreenshot && <a className="text-blue-700 hover:underline" href={fileUrl(ev.baselineScreenshot)!} target="_blank" rel="noreferrer">full baseline screenshot</a>}
            {ev.currentScreenshot && <a className="text-blue-700 hover:underline" href={fileUrl(ev.currentScreenshot)!} target="_blank" rel="noreferrer">full current screenshot</a>}
            {ev.diffImage && <a className="text-blue-700 hover:underline" href={fileUrl(ev.diffImage)!} target="_blank" rel="noreferrer">pixel difference image</a>}
          </div>
          {ev.details?.length ? <pre className="max-h-64 overflow-auto rounded bg-gray-50 p-2">{ev.details.join("\n")}</pre> : null}
        </div>
      </details>
    </li>
  );
}
