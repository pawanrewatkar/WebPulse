import Link from "next/link";
import { getRepo } from "@core/db";
import { Empty, PageHeader, StatusBadge } from "@/components/ui";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ComparisonsPage() {
  const repo = getRepo();
  const [comparisons, websites] = await Promise.all([repo.listComparisons(), repo.listWebsites()]);
  const runCache = new Map<number, Awaited<ReturnType<typeof repo.getRun>>>();
  for (const c of comparisons) if (!runCache.has(c.baselineRunId)) runCache.set(c.baselineRunId, await repo.getRun(c.baselineRunId));
  return (
    <div>
      <PageHeader title="Comparisons" subtitle="Results of “Compare Website” runs. Open one to review changes and download reports." />
      <div className="card overflow-x-auto">
        <table className="tbl">
          <thead><tr><th>#</th><th>Website</th><th>Baseline</th><th>Status</th><th>Changes</th><th>Critical / High</th><th>Pages changed</th><th>Crawl failures</th><th>Date</th></tr></thead>
          <tbody>
            {comparisons.map((c) => {
              const s = c.summary;
              return (
                <tr key={c.id}>
                  <td><Link className="font-medium text-blue-700 hover:underline" href={`/comparisons/${c.id}`}>#{c.id}</Link></td>
                  <td>{websites.find((w) => w.id === c.websiteId)?.name}</td>
                  <td>v{runCache.get(c.baselineRunId)?.version ?? "?"}</td>
                  <td><StatusBadge status={c.status} /></td>
                  <td>{s?.totalChanges ?? "—"}</td>
                  <td>{s ? `${s.bySeverity.critical ?? 0} / ${s.bySeverity.high ?? 0}` : "—"}</td>
                  <td>{s ? `${s.pagesChanged} / ${s.pages.length}` : "—"}</td>
                  <td>{s?.pagesFailed ? <span className="text-red-700">{s.pagesFailed}</span> : 0}</td>
                  <td className="whitespace-nowrap text-gray-500">{fmtDate(c.createdAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!comparisons.length && <div className="p-4"><Empty>No comparisons yet.</Empty></div>}
      </div>
    </div>
  );
}
