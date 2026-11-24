import { getRepo } from "@core/db";
import Explorer from "@/components/Explorer";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ExplorerPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const websites = await getRepo().listWebsites();
  return (
    <div>
      <PageHeader title="Baseline Explorer" subtitle="Inspect stored captures without crawling. Compare any stored page against another capture side by side." />
      <Explorer
        websites={websites.map((w) => ({ id: w.id, name: w.name, baseUrl: w.baseUrl, activeBaselineId: w.activeBaselineId }))}
        initial={{
          websiteId: sp.website ? Number(sp.website) : websites[0]?.id ?? null,
          runId: sp.run ? Number(sp.run) : null,
          urlKey: sp.url ?? null,
          device: sp.device === "mobile" ? "mobile" : "desktop",
          compareRunId: sp.compare ? Number(sp.compare) : null,
        }}
      />
    </div>
  );
}
