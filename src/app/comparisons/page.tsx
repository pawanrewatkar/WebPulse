import Link from "next/link";
import { getRepo } from "@core/db";
import { Empty, PageHeader, StatusBadge } from "@/components/ui";
import PaginatedTable from "@/components/Paginated";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ComparisonsPage() {
  const repo = getRepo();
  const [comparisons, websites] = await Promise.all([repo.listComparisons(), repo.listWebsites()]); // newest first
  const runCache = new Map<number, Awaited<ReturnType<typeof repo.getRun>>>();
  for (const c of comparisons) if (!runCache.has(c.baselineRunId)) runCache.set(c.baselineRunId, await repo.getRun(c.baselineRunId));
  return (
    <div>
      <PageHeader title="Comparisons" subtitle="Results of “Compare Website” runs. Open one to review changes and download reports." />
      <PaginatedTable
        label="comparisons"
        headers={["Compared on", "Website", "Baseline", "Status", "Changes", "Critical / High", "Pages changed", "Crawl failures"]}
        rows={comparisons.map((c) => {
          const s = c.summary;
          return {
            key: c.id,
            cells: (
              <>
                <td className="whitespace-nowrap"><Link className="font-medium text-blue-700 hover:underline" href={`/comparisons/${c.id}`} title="Open comparison results">{fmtDate(c.createdAt)}</Link></td>
                <td>{websites.find((w) => w.id === c.websiteId)?.name}</td>
                <td>v{runCache.get(c.baselineRunId)?.version ?? "?"}</td>
                <td><StatusBadge status={c.status} /></td>
                <td>{s?.totalChanges ?? "—"}</td>
                <td>{s ? `${s.bySeverity.critical ?? 0} / ${s.bySeverity.high ?? 0}` : "—"}</td>
                <td>{s ? `${s.pagesChanged} / ${s.pages.length}` : "—"}</td>
                <td>{s?.pagesFailed ? <span className="text-red-700">{s.pagesFailed}</span> : 0}</td>
              </>
            ),
          };
        })}
        empty={<Empty>No comparisons yet.</Empty>}
      />
    </div>
  );
}
