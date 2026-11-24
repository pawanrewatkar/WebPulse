import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepo } from "@core/db";
import { Empty, PageHeader, StatusBadge } from "@/components/ui";
import WebsiteActions, { RestoreBaselineButton } from "@/components/WebsiteActions";
import WorkerStatus from "@/components/WorkerStatus";
import IgnoreRules from "@/components/IgnoreRules";
import { fmtDate, fmtDuration } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function WebsitePage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const repo = getRepo();
  const website = await repo.getWebsite(id);
  if (!website) notFound();
  const [runs, comparisons, activeJob, jobs] = await Promise.all([
    repo.listRuns(id),
    repo.listComparisons(id),
    repo.hasActiveJob(id),
    repo.listJobs({ websiteId: id, limit: 10 }),
  ]);
  const baselines = runs.filter((r) => r.kind === "baseline");
  const otherRuns = runs.filter((r) => r.kind !== "baseline");
  const usableBaselines = baselines.filter((b) => b.status === "completed" || b.status === "partial");
  const s = website.settings;

  return (
    <div className="space-y-6">
      <WorkerStatus />
      <PageHeader
        title={website.name}
        subtitle={<a href={website.baseUrl} target="_blank" rel="noreferrer" className="hover:underline">{website.baseUrl}</a>}
        actions={
          <>
            <Link className="btn" href={`/explorer?website=${id}`}>Baseline Explorer</Link>
            <Link className="btn" href={`/websites/${id}/edit`}>Settings</Link>
          </>
        }
      />

      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-600">
        <span>Access: <strong>{s.auth ? `Login (${website.credentialsUsername ?? "no credentials"})` : "Public"}</strong></span>
        <span>Devices: <strong>{s.devices.join(", ")}</strong></span>
        <span>Max pages: <strong>{s.maxPages}</strong> · depth <strong>{s.maxDepth}</strong></span>
        <span>Discovery: <strong>{[s.useSitemap && "sitemap", s.followLinks && "links"].filter(Boolean).join(" + ") || "manual only"}</strong></span>
        {s.includeUrls.length > 0 && <span>Manual URLs: <strong>{s.includeUrls.length}</strong></span>}
        {s.excludePatterns.length > 0 && <span>Exclusions: <strong>{s.excludePatterns.length}</strong></span>}
      </div>

      <WebsiteActions
        websiteId={id}
        hasActiveBaseline={!!website.activeBaselineId}
        activeBaselineId={website.activeBaselineId}
        nextVersion={(baselines[0]?.version ?? 0) + 1}
        baselines={usableBaselines.map((b) => ({ id: b.id, version: b.version, label: b.label, createdAt: b.createdAt }))}
        activeJobId={activeJob?.id ?? null}
      />

      <section>
        <h2 className="mb-2 font-semibold">Baseline versions</h2>
        <div className="card overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>Version</th><th>Label</th><th>Status</th><th>Pages</th><th>Captured</th><th>Duration</th><th></th></tr></thead>
            <tbody>
              {baselines.map((b) => (
                <tr key={b.id}>
                  <td className="font-medium">v{b.version} {b.id === website.activeBaselineId && <span className="badge ml-1 bg-blue-100 text-blue-800">active</span>}</td>
                  <td>{b.label ?? "—"}</td>
                  <td><StatusBadge status={b.status} />{b.error && <div className="mt-1 max-w-xs text-xs text-red-700">{b.error}</div>}</td>
                  <td title="page × device captures">{b.stats.captured ?? 0} captures{b.stats.failed ? <span className="text-red-700"> · {b.stats.failed} failed</span> : null}{b.stats.httpErrors ? <span className="text-orange-700"> · {b.stats.httpErrors} HTTP err</span> : null}</td>
                  <td className="whitespace-nowrap text-gray-600">{fmtDate(b.finishedAt ?? b.createdAt)}</td>
                  <td>{fmtDuration(b.stats.durationMs)}</td>
                  <td className="space-x-2 whitespace-nowrap text-right">
                    {(b.status === "completed" || b.status === "partial") && (
                      <>
                        <Link className="btn py-0.5 text-xs" href={`/explorer?website=${id}&run=${b.id}`}>Explore</Link>
                        {b.id !== website.activeBaselineId && <RestoreBaselineButton websiteId={id} runId={b.id} version={b.version} />}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!baselines.length && <div className="p-4"><Empty>No baselines yet. Use “Save Website” to capture the first one.</Empty></div>}
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Comparisons</h2>
        <div className="card overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>#</th><th>Baseline</th><th>Status</th><th>Changes</th><th>Pages changed</th><th>Failed</th><th>Date</th></tr></thead>
            <tbody>
              {comparisons.map((c) => {
                const b = baselines.find((r) => r.id === c.baselineRunId);
                return (
                  <tr key={c.id}>
                    <td><Link href={`/comparisons/${c.id}`} className="font-medium text-blue-700 hover:underline">#{c.id}</Link></td>
                    <td>v{b?.version ?? "?"}</td>
                    <td><StatusBadge status={c.status} /></td>
                    <td>{c.summary?.totalChanges ?? "—"}</td>
                    <td>{c.summary ? `${c.summary.pagesChanged} / ${c.summary.pagesCompared}` : "—"}</td>
                    <td>{c.summary?.pagesFailed ? <span className="text-red-700">{c.summary.pagesFailed}</span> : 0}</td>
                    <td className="text-gray-600">{fmtDate(c.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!comparisons.length && <div className="p-4"><Empty>No comparisons yet.</Empty></div>}
        </div>
      </section>

      {otherRuns.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">Other captures (comparison crawls & manual captures)</h2>
          <div className="card overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Run</th><th>Kind</th><th>Status</th><th>Pages</th><th>Date</th><th></th></tr></thead>
              <tbody>
                {otherRuns.slice(0, 20).map((r) => (
                  <tr key={r.id}>
                    <td>#{r.id}</td>
                    <td>{r.kind}</td>
                    <td><StatusBadge status={r.status} /></td>
                    <td>{r.stats.captured ?? 0}{r.stats.failed ? ` · ${r.stats.failed} failed` : ""}</td>
                    <td className="text-gray-600">{fmtDate(r.createdAt)}</td>
                    <td className="text-right"><Link className="btn py-0.5 text-xs" href={`/explorer?website=${id}&run=${r.id}`}>Explore</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <IgnoreRules websiteId={id} />

      <section>
        <h2 className="mb-2 font-semibold">Recent jobs</h2>
        <div className="card overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>Job</th><th>Type</th><th>Status</th><th>Message</th><th>Created</th></tr></thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td><Link className="text-blue-700 hover:underline" href={`/jobs/${j.id}`}>#{j.id}</Link></td>
                  <td>{j.type}</td>
                  <td><StatusBadge status={j.status} /></td>
                  <td className="max-w-lg truncate text-gray-600">{j.error ?? j.message}</td>
                  <td className="text-gray-500">{fmtDate(j.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!jobs.length && <div className="p-4"><Empty>No jobs yet.</Empty></div>}
        </div>
      </section>
    </div>
  );
}
