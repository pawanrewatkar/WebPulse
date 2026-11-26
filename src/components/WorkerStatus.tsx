"use client";

import { useEffect, useState } from "react";

/** Warns when no background worker is running (jobs would stay queued). */
export default function WorkerStatus() {
  const [state, setState] = useState<{ workers: unknown[]; queuedJobs: number } | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch("/api/health", { cache: "no-store" });
        if (r.ok && alive) setState(await r.json());
      } catch {
        /* ignore */
      }
    };
    tick();
    const t = setInterval(tick, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  if (!state) return null;
  if (state.workers.length > 0)
    return <div className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />Worker online{state.queuedJobs ? ` · ${state.queuedJobs} job(s) queued` : ""}</div>;
  return (
    <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <strong>Background worker is not running.</strong> Crawls and comparisons will stay queued until you start it in a second terminal:{" "}
      <code className="rounded bg-amber-100 px-1">npm run worker</code>
      {state.queuedJobs ? ` (${state.queuedJobs} job(s) waiting)` : ""}
    </div>
  );
}
