"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import JobProgress from "./JobProgress";

interface BaselineOpt {
  id: number;
  version: number | null;
  label: string | null;
  createdAt: string;
}

export default function WebsiteActions(props: {
  websiteId: number;
  hasActiveBaseline: boolean;
  activeBaselineId: number | null;
  nextVersion: number;
  baselines: BaselineOpt[];
  activeJobId: number | null;
}) {
  const router = useRouter();
  const [jobId, setJobId] = useState<number | null>(props.activeJobId);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [label, setLabel] = useState("");
  const [baselineId, setBaselineId] = useState<number | "">(props.activeBaselineId ?? props.baselines[0]?.id ?? "");
  const [busy, setBusy] = useState(false);

  async function post(url: string, body: unknown) {
    setError(null);
    setBusy(true);
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? `Request failed (${res.status})`);
      return;
    }
    setJobId(data.job.id);
    setConfirming(false);
    router.refresh();
  }

  const saveBaseline = () =>
    post(`/api/websites/${props.websiteId}/baseline`, { label: label || undefined, setActive: true, confirmNewVersion: props.hasActiveBaseline });

  return (
    <div className="card space-y-4 p-5">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <h3 className="font-semibold">A. Save Website (baseline)</h3>
          <p className="text-sm text-gray-600">Crawl all configured pages and store screenshots, content and DOM as baseline v{props.nextVersion}.</p>
          <input className="input" placeholder={`Label (optional), e.g. "Release 2.4"`} value={label} onChange={(e) => setLabel(e.target.value)} />
          <button
            className="btn-primary"
            disabled={busy || !!jobId}
            onClick={() => (props.hasActiveBaseline ? setConfirming(true) : saveBaseline())}
          >
            Save Website
          </button>
        </div>
        <div className="space-y-2">
          <h3 className="font-semibold">B. Compare Website</h3>
          <p className="text-sm text-gray-600">Recrawl the website now and compare it against a saved baseline.</p>
          <select className="input" value={baselineId} onChange={(e) => setBaselineId(Number(e.target.value))} disabled={!props.baselines.length}>
            {!props.baselines.length && <option value="">No baselines yet</option>}
            {props.baselines.map((b) => (
              <option key={b.id} value={b.id}>
                v{b.version} {b.label ? `– ${b.label}` : ""} ({new Date(b.createdAt).toLocaleDateString()}){b.id === props.activeBaselineId ? " · active" : ""}
              </option>
            ))}
          </select>
          <button className="btn-primary" disabled={busy || !!jobId || !baselineId} onClick={() => post(`/api/websites/${props.websiteId}/compare`, { baselineRunId: baselineId })}>
            Compare Website
          </button>
        </div>
      </div>

      {confirming && (
        <div role="dialog" className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm">
          <p className="font-medium text-amber-900">Create a new baseline version?</p>
          <p className="mt-1 text-amber-900">
            This creates <strong>baseline v{props.nextVersion}</strong> and makes it the active baseline when it completes. Existing baseline versions are
            <strong> not overwritten</strong> — they stay in history and can be restored at any time.
          </p>
          <div className="mt-3 flex gap-2">
            <button className="btn-primary" onClick={saveBaseline} disabled={busy}>Yes, create v{props.nextVersion}</button>
            <button className="btn" onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        </div>
      )}
      {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}
      {jobId && (
        <div className="border-t border-gray-100 pt-4">
          <JobProgress jobId={jobId} />
          <button className="mt-2 text-xs text-gray-500 hover:underline" onClick={() => setJobId(null)}>Dismiss</button>
        </div>
      )}
    </div>
  );
}

export function RestoreBaselineButton({ websiteId, runId, version }: { websiteId: number; runId: number; version: number | null }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  return (
    <>
      <button
        className="btn py-0.5 text-xs"
        onClick={async () => {
          if (!confirm(`Make baseline v${version} the active baseline? Other versions are kept.`)) return;
          const r = await fetch(`/api/websites/${websiteId}/restore`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId }) });
          if (!r.ok) setErr((await r.json()).error);
          router.refresh();
        }}
      >
        Restore as active
      </button>
      {err && <span className="ml-2 text-xs text-red-700">{err}</span>}
    </>
  );
}
