import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepo } from "@core/db";
import ComparisonView from "@/components/ComparisonView";
import { PageHeader, Stat, StatusBadge } from "@/components/ui";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ComparisonPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const repo = getRepo();
  const cmp = await repo.getComparison(id);
  if (!cmp) notFound();
  const [website, baseline, current] = await Promise.all([repo.getWebsite(cmp.websiteId), repo.getRun(cmp.baselineRunId), repo.getRun(cmp.currentRunId)]);
  const s = cmp.summary;
  return (
    <div className="space-y-5">
      <PageHeader
        title={`Comparison #${cmp.id} · ${website?.name ?? ""}`}
        subtitle={
          <>
            Baseline v{baseline?.version} ({fmtDate(baseline?.finishedAt ?? baseline?.createdAt)}) → current crawl {fmtDate(current?.finishedAt ?? current?.createdAt)} ·{" "}
            <StatusBadge status={cmp.status} />
            {current && current.status !== "completed" && <span className="ml-2 text-amber-800">Current crawl status: {current.status}{current.error ? ` – ${current.error}` : ""}</span>}
          </>
        }
        actions={
          cmp.status === "completed" ? (
            <>
              <a className="btn" href={`/api/comparisons/${cmp.id}/report?format=xlsx`}>Download Excel</a>
              <a className="btn" href={`/api/comparisons/${cmp.id}/report?format=pdf`}>Download PDF</a>
              <Link className="btn" href={`/explorer?website=${cmp.websiteId}&run=${cmp.baselineRunId}&compare=${cmp.currentRunId}`}>Open in Explorer</Link>
            </>
          ) : undefined
        }
      />
      {cmp.error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{cmp.error}</div>}
      {s && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
          <Stat label="Changes" value={s.totalChanges} />
          <Stat label="Critical" value={s.bySeverity.critical ?? 0} tone={s.bySeverity.critical ? "text-red-700" : undefined} />
          <Stat label="High" value={s.bySeverity.high ?? 0} tone={s.bySeverity.high ? "text-orange-700" : undefined} />
          <Stat label="Pages changed" value={`${s.pagesChanged}/${s.pages.length}`} />
          <Stat label="New pages" value={s.pagesNew} />
          <Stat label="Removed (404/410)" value={s.pagesRemoved} tone={s.pagesRemoved ? "text-red-700" : undefined} />
          <Stat label="Crawl failures" value={s.pagesFailed} tone={s.pagesFailed ? "text-red-700" : undefined} />
        </div>
      )}
      {s && s.pagesFailed > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {s.pagesFailed} page view(s) could not be loaded during the current crawl. They are listed as <strong>crawl failed – not verified</strong> and are
          <strong> not</strong> reported as removed. Re-run the comparison or check them manually.
        </div>
      )}
      {s?.autoIgnored ? <p className="text-xs text-gray-500">{s.autoIgnored} change(s) were automatically ignored by your “always ignore” rules (shown when “include ignored” is ticked).</p> : null}
      {cmp.status === "completed" && s && <ComparisonView comparisonId={cmp.id} websiteId={cmp.websiteId} baselineRunId={cmp.baselineRunId} currentRunId={cmp.currentRunId} pages={s.pages} baseUrl={website?.baseUrl ?? ""} />}
    </div>
  );
}
