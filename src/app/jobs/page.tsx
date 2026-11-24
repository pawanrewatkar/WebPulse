import Link from "next/link";
import { getRepo } from "@core/db";
import { Empty, PageHeader, StatusBadge } from "@/components/ui";
import WorkerStatus from "@/components/WorkerStatus";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function JobsPage() {
  const repo = getRepo();
  const [jobs, websites] = await Promise.all([repo.listJobs({ limit: 200 }), repo.listWebsites()]);
  return (
    <div>
      <WorkerStatus />
      <PageHeader title="Jobs" subtitle="Background crawl and comparison jobs processed by the worker." />
      <div className="card overflow-x-auto">
        <table className="tbl">
          <thead><tr><th>Job</th><th>Type</th><th>Website</th><th>Status</th><th>Progress</th><th>Message</th><th>Created</th><th>Finished</th></tr></thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id}>
                <td><Link href={`/jobs/${j.id}`} className="text-blue-700 hover:underline">#{j.id}</Link></td>
                <td>{j.type}</td>
                <td>{websites.find((w) => w.id === j.websiteId)?.name ?? "—"}</td>
                <td><StatusBadge status={j.status} /></td>
                <td>{Math.round(j.progress * 100)}%</td>
                <td className="max-w-md truncate text-gray-600">{j.error ?? j.message}</td>
                <td className="whitespace-nowrap text-gray-500">{fmtDate(j.createdAt)}</td>
                <td className="whitespace-nowrap text-gray-500">{fmtDate(j.finishedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!jobs.length && <div className="p-4"><Empty>No jobs yet.</Empty></div>}
      </div>
    </div>
  );
}
