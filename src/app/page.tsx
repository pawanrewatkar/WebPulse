import Link from "next/link";
import { getRepo } from "@core/db";
import { Empty, PageHeader, Stat, StatusBadge } from "@/components/ui";
import WorkerStatus from "@/components/WorkerStatus";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const repo = getRepo();
  const [websites, comparisons, jobs] = await Promise.all([repo.listWebsites(), repo.listComparisons(), repo.listJobs({ limit: 8 })]);
  const rows = await Promise.all(
    websites.map(async (w) => {
      const runs = await repo.listRuns(w.id, "baseline");
      const active = runs.find((r) => r.id === w.activeBaselineId) ?? null;
      const lastCmp = comparisons.find((c) => c.websiteId === w.id) ?? null;
      return { w, baselines: runs.length, active, lastCmp };
    }),
  );
  const openChanges = comparisons.filter((c) => c.status === "completed").slice(0, 20).reduce((n, c) => n + (c.summary?.totalChanges ?? 0), 0);

  return (
    <div>
      <WorkerStatus />
      <PageHeader title="Dashboard" subtitle="Weekly website QA: save baselines, compare, review changes." actions={<Link href="/websites/new" className="btn-primary">+ Add website</Link>} />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Websites" value={websites.length} />
        <Stat label="Comparisons" value={comparisons.length} />
        <Stat label="Changes (recent 20 runs)" value={openChanges} tone={openChanges ? "text-orange-700" : undefined} />
        <Stat label="Active jobs" value={jobs.filter((j) => j.status === "running" || j.status === "queued").length} />
      </div>

      <div className="card mb-6 overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>Website</th>
              <th>Active baseline</th>
              <th>Versions</th>
              <th>Last comparison</th>
              <th>Changes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ w, baselines, active, lastCmp }) => (
              <tr key={w.id}>
                <td>
                  <Link href={`/websites/${w.id}`} className="font-medium text-blue-700 hover:underline">{w.name}</Link>
                  <div className="text-xs text-gray-500">{w.baseUrl}</div>
                </td>
                <td>{active ? <>v{active.version} <span className="text-xs text-gray-500">{fmtDate(active.finishedAt)}</span></> : <span className="text-gray-400">none</span>}</td>
                <td>{baselines}</td>
                <td>
                  {lastCmp ? (
                    <Link href={`/comparisons/${lastCmp.id}`} className="hover:underline">
                      #{lastCmp.id} <StatusBadge status={lastCmp.status} /> <span className="text-xs text-gray-500">{fmtDate(lastCmp.createdAt)}</span>
                    </Link>
                  ) : (
                    <span className="text-gray-400">never</span>
                  )}
                </td>
                <td>{lastCmp?.summary ? lastCmp.summary.totalChanges : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!websites.length && (
          <div className="p-4">
            <Empty>
              No websites yet. <Link href="/websites/new" className="text-blue-700 hover:underline">Add your first website</Link>.
            </Empty>
          </div>
        )}
      </div>

      <h2 className="mb-2 font-semibold">Recent jobs</h2>
      <div className="card overflow-x-auto">
        <table className="tbl">
          <thead><tr><th>Job</th><th>Type</th><th>Website</th><th>Status</th><th>Message</th><th>Created</th></tr></thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id}>
                <td><Link href={`/jobs/${j.id}`} className="text-blue-700 hover:underline">#{j.id}</Link></td>
                <td>{j.type}</td>
                <td>{websites.find((w) => w.id === j.websiteId)?.name ?? "—"}</td>
                <td><StatusBadge status={j.status} /></td>
                <td className="max-w-md truncate text-gray-600">{j.error ?? j.message}</td>
                <td className="whitespace-nowrap text-gray-500">{fmtDate(j.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!jobs.length && <div className="p-4"><Empty>No jobs yet.</Empty></div>}
      </div>
    </div>
  );
}
