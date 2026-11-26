import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepo } from "@core/db";
import JobProgress from "@/components/JobProgress";
import { PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const JOB_TYPE_LABEL: Record<string, string> = { baseline: "Baseline", compare: "Comparison", capture: "Capture", recompare: "Re-comparison" };

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const job = await getRepo().getJob(Number((await params).id));
  if (!job) notFound();
  const website = job.websiteId ? await getRepo().getWebsite(job.websiteId) : null;
  return (
    <div className="space-y-4">
      <PageHeader
        title={`${JOB_TYPE_LABEL[job.type] ?? job.type} – ${website?.name ?? "deleted website"} – ${fmtDate(job.createdAt)}`}
        subtitle={website ? <Link className="hover:underline" href={`/websites/${website.id}`}>Open {website.name}</Link> : undefined}
      />
      <div className="card p-5">
        <JobProgress jobId={job.id} showLogs refreshOnDone={false} />
      </div>
    </div>
  );
}
