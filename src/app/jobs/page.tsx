import Link from "next/link";
import { getRepo } from "@core/db";
import { Empty, PageHeader, StatusBadge } from "@/components/ui";
import PaginatedTable from "@/components/Paginated";
import WorkerStatus from "@/components/WorkerStatus";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function JobsPage() {
  const repo = getRepo();
  const [jobs, websites] = await Promise.all([repo.listJobs({ limit: 500 }), repo.listWebsites()]); // newest first
  return (
    <div>
      <WorkerStatus />
      <PageHeader title="Jobs" subtitle="Background crawl and comparison jobs processed by the worker." />
      <PaginatedTable
        label="jobs"
        headers={["Type", "Website", "Status", "Progress", "Message", "Created", "Finished"]}
        rows={jobs.map((j) => ({
          key: j.id,
          cells: (
            <>
              <td>{j.type}</td>
              <td>{websites.find((w) => w.id === j.websiteId)?.name ?? "—"}</td>
              <td><StatusBadge status={j.status} /></td>
              <td>{Math.round(j.progress * 100)}%</td>
              <td className="max-w-md truncate"><Link href={`/jobs/${j.id}`} className="text-blue-700 hover:underline" title="Open job details and log">{j.error ?? j.message ?? "View details"}</Link></td>
              <td className="whitespace-nowrap text-gray-500">{fmtDate(j.createdAt)}</td>
              <td className="whitespace-nowrap text-gray-500">{fmtDate(j.finishedAt)}</td>
            </>
          ),
        }))}
        empty={<Empty>No jobs yet.</Empty>}
      />
    </div>
  );
}
