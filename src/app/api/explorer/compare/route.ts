import { NextResponse } from "next/server";
import { getRepo } from "@core/db";
import { ServiceError } from "@core/services";
import { comparePagePair } from "@core/compare/engine";
import { handler, parseId } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Manual comparison of two stored page captures (e.g. a baseline page vs a later capture).
 * Uses only stored data – no crawling. Diff images/crops are written under storage "manual/".
 */
export const GET = handler(async (req: Request) => {
  const sp = new URL(req.url).searchParams;
  const aId = parseId(sp.get("a") ?? undefined);
  const bId = parseId(sp.get("b") ?? undefined);
  const repo = getRepo();
  const [a, b] = await Promise.all([repo.getPage(aId), repo.getPage(bId)]);
  if (!a || !b) throw new ServiceError("Page not found", 404);
  const [ra, rb] = await Promise.all([repo.getRun(a.runId), repo.getRun(b.runId)]);
  if (!ra || !rb || ra.websiteId !== rb.websiteId) throw new ServiceError("Pages belong to different websites", 400);
  const website = await repo.getWebsite(ra.websiteId);
  if (!website) throw new ServiceError("Website not found", 404);
  if (a.status === "failed" || b.status === "failed") {
    return NextResponse.json({ a, b, changes: [], visual: null, note: "One of the captures failed to load, so there is nothing to compare." });
  }
  const [ca, cb] = await Promise.all([repo.listLinkChecks(a.runId), repo.listLinkChecks(b.runId)]);
  const result = await comparePagePair(a, b, website.settings, { before: ca, after: cb }, `manual/${a.id}-${b.id}`, { maxCrops: 60 });
  const changes = result.detected.map((d, i) => ({
    category: d.category,
    changeType: d.changeType,
    severity: d.severity,
    description: d.description,
    expected: d.expected,
    actual: d.actual,
    selector: d.selector,
    evidence: result.evidenceByIndex.get(i),
  }));
  return NextResponse.json({ a, b, changes, visual: result.visual, note: a.device !== b.device ? "Note: comparing different devices." : null });
});
