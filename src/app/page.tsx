import Link from "next/link";
import { getRepo } from "@core/db";
import { Empty, PageHeader, Stat, StatusBadge } from "@/components/ui";
import WorkerStatus from "@/components/WorkerStatus";
import PaginatedTable from "@/components/Paginated";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const repo = getRepo();
  const [websites, comparisons, jobs] = await Promise.all([repo.listWebsites(), repo.listComparisons(), repo.listJobs({ limit: 200 })]);
  const rows = await Promise.all(
    // Newest website first
    [...websites].sort((a, b) => b.id - a.id).map(async (w) => {
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
      <PageHeader title="Dashboard" subtitle="Website QA on your schedule: save baselines, compare, review changes." actions={<Link href="/websites/new" className="btn-primary">+ Add website</Link>} />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Websites" value={websites.length} accent="indigo" />
        <Stat label="Comparisons" value={comparisons.length} accent="sky" />
        <Stat label="Changes (recent 20 runs)" value={openChanges} tone={openChanges ? "text-orange-700" : undefined} accent="amber" />
        <Stat label="Active jobs" value={jobs.filter((j) => j.status === "running" || j.status === "queued").length} accent="emerald" />
      </div>

      {!websites.length && (
        <div className="relative mb-6 overflow-hidden rounded-2xl bg-linear-to-br from-indigo-600 via-violet-600 to-fuchsia-500 p-6 text-white shadow-xl shadow-indigo-200">
          <div className="pointer-events-none absolute -top-16 -right-16 h-56 w-56 rounded-full bg-white/10" />
          <div className="pointer-events-none absolute -bottom-20 left-1/3 h-48 w-48 rounded-full bg-white/10" />
          <h2 className="text-xl font-bold">Get started in 3 steps</h2>
          <p className="mt-1 text-sm text-indigo-100">Catch unexpected website changes before your users do.</p>
          <ol className="relative mt-5 grid gap-3 md:grid-cols-3">
            {[
              ["1", "Add a website", "Enter its URL and choose desktop, mobile or both."],
              ["2", "Save a baseline", "Capture screenshots and content of every page."],
              ["3", "Compare anytime", "Re-check the site as often as you need – twice a week, weekly or every 15 days – and review what changed."],
            ].map(([n, t, d]) => (
              <li key={n} className="rounded-xl bg-white/15 p-4 ring-1 ring-white/25 backdrop-blur-sm">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-sm font-bold text-indigo-700">{n}</span>
                <div className="mt-2 font-semibold">{t}</div>
                <div className="text-sm text-indigo-100">{d}</div>
              </li>
            ))}
          </ol>
          <Link href="/websites/new" className="relative mt-5 inline-flex items-center rounded-lg bg-white px-4 py-2 text-sm font-semibold text-indigo-700 shadow-md transition hover:bg-indigo-50">
            + Add your first website
          </Link>
        </div>
      )}

      <div className="mb-6">
        <PaginatedTable
          label="websites"
          headers={["Website", "Active baseline", "Versions", "Last comparison", "Changes"]}
          rows={rows.map(({ w, baselines, active, lastCmp }) => ({
            key: w.id,
            cells: (
              <>
                <td>
                  <Link href={`/websites/${w.id}`} className="font-medium text-blue-700 hover:underline">{w.name}</Link>
                  <div className="text-xs text-gray-500">{w.baseUrl}</div>
                </td>
                <td>{active ? <>v{active.version} <span className="text-xs text-gray-500">{fmtDate(active.finishedAt)}</span></> : <span className="text-gray-400">none</span>}</td>
                <td>{baselines}</td>
                <td>
                  {lastCmp ? (
                    <Link href={`/comparisons/${lastCmp.id}`} className="hover:underline">
                      <span className="text-blue-700">{fmtDate(lastCmp.createdAt)}</span> <StatusBadge status={lastCmp.status} />
                    </Link>
                  ) : (
                    <span className="text-gray-400">never</span>
                  )}
                </td>
                <td>{lastCmp?.summary ? lastCmp.summary.totalChanges : "—"}</td>
              </>
            ),
          }))}
          empty={
            <Empty>
              No websites yet. <Link href="/websites/new" className="text-blue-700 hover:underline">Add your first website</Link>.
            </Empty>
          }
        />
      </div>

      <h2 className="mb-2 font-semibold">Recent jobs</h2>
      <PaginatedTable
        label="jobs"
        headers={["Type", "Website", "Status", "Message", "Created"]}
        rows={jobs.map((j) => ({
          key: j.id,
          cells: (
            <>
              <td>{j.type}</td>
              <td>{websites.find((w) => w.id === j.websiteId)?.name ?? "—"}</td>
              <td><StatusBadge status={j.status} /></td>
              <td className="max-w-md truncate"><Link href={`/jobs/${j.id}`} className="text-blue-700 hover:underline" title="Open job details and log">{j.error ?? j.message ?? "View details"}</Link></td>
              <td className="whitespace-nowrap text-gray-500">{fmtDate(j.createdAt)}</td>
            </>
          ),
        }))}
        empty={<Empty>No jobs yet.</Empty>}
      />
    </div>
  );
}
