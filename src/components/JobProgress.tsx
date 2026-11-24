"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Job, JobLog } from "@core/types";
import { StatusBadge } from "./ui";

/** Polls a job until it finishes; shows progress, message and (optionally) live logs. */
export default function JobProgress({ jobId, showLogs = false, refreshOnDone = true }: { jobId: number; showLogs?: boolean; refreshOnDone?: boolean }) {
  const router = useRouter();
  const [job, setJob] = useState<Job | null>(null);
  const [logs, setLogs] = useState<JobLog[]>([]);
  const lastLog = useRef(0);
  const done = useRef(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}?after=${lastLog.current}`, { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          if (!alive) return;
          setJob(data.job);
          if (data.logs.length) {
            lastLog.current = data.logs[data.logs.length - 1].id;
            setLogs((l) => [...l, ...data.logs].slice(-500));
          }
          if (["completed", "failed", "cancelled"].includes(data.job.status)) {
            if (!done.current && refreshOnDone) router.refresh();
            done.current = true;
            return;
          }
        }
      } catch {
        /* retry */
      }
      if (alive) timer = setTimeout(tick, 1500);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [jobId, refreshOnDone, router]);

  if (!job) return <div className="text-sm text-gray-500">Loading job #{jobId}…</div>;
  const pct = Math.round((job.progress ?? 0) * 100);
  const active = job.status === "queued" || job.status === "running";
  const result = job.result as Record<string, unknown> | null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link href={`/jobs/${job.id}`} className="font-medium text-blue-700 hover:underline">Job #{job.id}</Link>
        <span className="text-gray-500">{job.type}</span>
        <span data-testid="job-status" data-status={job.status}><StatusBadge status={job.status} /></span>
        {active && (
          <button
            className="btn ml-auto py-0.5 text-xs"
            onClick={() => fetch(`/api/jobs/${job.id}/cancel`, { method: "POST" })}
            disabled={job.cancelRequested}
          >
            {job.cancelRequested ? "Cancelling…" : "Cancel"}
          </button>
        )}
      </div>
      {active && (
        <div className="h-2 w-full overflow-hidden rounded bg-gray-200">
          <div className="h-full bg-blue-600 transition-all" style={{ width: `${Math.max(pct, 2)}%` }} />
        </div>
      )}
      <div className="text-sm text-gray-700">{job.status === "queued" ? "Waiting for the worker to pick up this job…" : job.message}</div>
      {job.error && <div className="rounded border border-red-200 bg-red-50 px-2 py-1 text-sm text-red-800">{job.error}</div>}
      {result?.comparisonId ? (
        <Link className="btn-primary" href={`/comparisons/${result.comparisonId}`}>Open comparison results →</Link>
      ) : null}
      {showLogs && (
        <pre className="max-h-96 overflow-auto rounded bg-gray-900 p-3 text-xs leading-relaxed text-gray-100">
          {logs.length ? logs.map((l) => `${l.ts.slice(11, 19)} ${l.level.toUpperCase().padEnd(5)} ${l.message}`).join("\n") : "No log entries yet."}
        </pre>
      )}
    </div>
  );
}
