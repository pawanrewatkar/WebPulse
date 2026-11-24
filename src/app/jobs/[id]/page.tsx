import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepo } from "@core/db";
import JobProgress from "@/components/JobProgress";
import { PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const job = await getRepo().getJob(Number((await params).id));
  if (!job) notFound();
  const website = job.websiteId ? await getRepo().getWebsite(job.websiteId) : null;
  return (
    <div className="space-y-4">
      <PageHeader
        title={`Job #${job.id} · ${job.type}`}
        subtitle={<>Created {fmtDate(job.createdAt)} {website && <>· <Link className="hover:underline" href={`/websites/${website.id}`}>{website.name}</Link></>}</>}
      />
      <div className="card p-5">
        <JobProgress jobId={job.id} showLogs refreshOnDone={false} />
      </div>
    </div>
  );
}
