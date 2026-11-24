import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { useTempDataDir } from "../helpers";
import { startFixtureServer, type FixtureServer } from "../fixtures/site-server";
import { getRepo } from "../../core/db";
import { createWebsite } from "../../core/services";
import { runJob } from "../../core/jobs/handlers";
import { createCliContext } from "../../core/jobs/context";
import { getStorage } from "../../core/storage";
import type { Change, Job } from "../../core/types";

const PORT = 4412;
let env: ReturnType<typeof useTempDataDir>;
let site: FixtureServer;
let comparisonId: number;
let changes: Change[];

async function run(job: Job) {
  const claimed = await getRepo().claimNextJob();
  expect(claimed?.id).toBe(job.id);
  return runJob(createCliContext(claimed!));
}

beforeAll(async () => {
  env = useTempDataDir();
  site = await startFixtureServer(PORT, 1);
  const repo = getRepo();
  const w = await createWebsite({
    name: "Fixture",
    baseUrl: site.url,
    settings: { pageTimeoutMs: 5000, retries: 0, crawlDelayMs: 0, waitAfterLoadMs: 100, maxPages: 20 },
  });
  await run(await repo.enqueueJob("baseline", w.id, { setActive: true }));
  site.setVersion(2);
  const baselineId = (await repo.getWebsite(w.id))!.activeBaselineId!;
  const res = await run(await repo.enqueueJob("compare", w.id, { baselineRunId: baselineId }));
  comparisonId = res.comparisonId as number;
  changes = await repo.listChanges(comparisonId, { includeIgnored: true });
  if (process.env.DUMP_CHANGES) {
    const fs = await import("node:fs");
    fs.writeFileSync(process.env.DUMP_CHANGES, JSON.stringify(changes.map(({ evidence, ...c }) => ({ ...c, details: evidence.details })), null, 1));
  }
}, 300_000);

afterAll(async () => {
  await site.close();
  env.cleanup();
});

const on = (path: string, device = "desktop") => changes.filter((c) => new URL(c.url).pathname === path && c.device === device);

describe("automatic comparison v1 → v2", () => {
  it("produces a completed comparison with a page-wise summary", async () => {
    const cmp = (await getRepo().getComparison(comparisonId))!;
    expect(cmp.status).toBe("completed");
    const s = cmp.summary!;
    expect(s.totalChanges).toBeGreaterThan(10);
    const status = (p: string, d = "desktop") => s.pages.find((x) => new URL(x.url).pathname === p && x.device === d)?.status;
    expect(status("/")).toBe("changed");
    expect(status("/about")).toBe("removed"); // genuine 404
    expect(status("/slow")).toBe("crawl_failed"); // timeout: NOT reported as removed
    expect(status("/pricing")).toBe("new_page");
    expect(status("/terms")).toBe("unchanged"); // only a timestamp differs (noise-filtered)
    expect(status("/terms", "mobile")).toBe("unchanged");
    expect(status("/blog/first-post")).toBe("changed"); // global nav gained a link in v2
    expect(status("/", "mobile")).toBe("changed");
  });

  it("never reports a crawl failure as a removed page", () => {
    const slow = on("/slow");
    expect(slow.some((c) => c.changeType === "removed")).toBe(false);
    expect(slow.find((c) => c.category === "page")?.changeType).toBe("potentially_broken");
    expect(slow.find((c) => c.category === "page")?.description).toMatch(/NOT a confirmed removal/);
  });

  it("detects removed pages, new pages", () => {
    expect(on("/about").find((c) => c.category === "page")).toMatchObject({ changeType: "removed", severity: "critical" });
    expect(on("/pricing").find((c) => c.category === "page")?.changeType).toBe("added");
  });

  it("detects home page content, heading, CTA, metadata, section, link, image and visual changes", () => {
    const home = on("/");
    const has = (category: string, type: string, re?: RegExp) => home.some((c) => c.category === category && c.changeType === type && (!re || re.test(`${c.description} ${c.expected} ${c.actual}`)));
    expect(has("metadata", "modified", /Page title/)).toBe(true);
    expect(has("metadata", "modified", /Meta description/)).toBe(true);
    expect(has("heading", "modified", /Acme Widgets Co\./)).toBe(true);
    expect(has("content", "modified", /affordable/)).toBe(true);
    expect(has("content", "modified", /Business-hours/)).toBe(true);
    expect(has("cta", "removed", /Contact Sales/)).toBe(true);
    expect(has("section", "added", /newsletter/)).toBe(true);
    expect(has("link", "potentially_broken", /old-page.*404/)).toBe(true);
    expect(has("image", "potentially_broken", /missing\.png/)).toBe(true);
    expect(has("visual", "modified")).toBe(true);
    // The footer timestamp changes on every request but must be filtered as noise.
    expect(home.some((c) => /Last updated/.test(`${c.expected} ${c.actual}`))).toBe(false);
  });

  it("detects responsive overflow on mobile only", () => {
    expect(on("/", "mobile").some((c) => c.category === "responsive" && c.changeType === "potentially_broken")).toBe(true);
    expect(on("/", "desktop").some((c) => c.category === "responsive")).toBe(false);
  });

  it("detects product image URL change, price change and form field change", () => {
    expect(on("/products").some((c) => c.category === "image" && c.changeType === "modified" && c.actual?.includes("widget-b-new"))).toBe(true);
    expect(on("/products").some((c) => c.category === "content" && c.expected?.includes("$29") && c.actual?.includes("$34"))).toBe(true);
    expect(on("/contact").some((c) => c.category === "form" && /phone/.test(c.description))).toBe(true);
  });

  it("stores before/after evidence files", async () => {
    const visual = on("/").find((c) => c.category === "visual")!;
    expect(visual.evidence.diffImage).toBeTruthy();
    expect(await getStorage().exists(visual.evidence.diffImage!)).toBe(true);
    expect(await getStorage().exists(visual.evidence.baselineScreenshot!)).toBe(true);
    expect(await getStorage().exists(visual.evidence.currentScreenshot!)).toBe(true);
    const heading = on("/").find((c) => c.category === "heading")!;
    expect(heading.evidence.baselineCrop && (await getStorage().exists(heading.evidence.baselineCrop))).toBe(true);
    expect(heading.evidence.currentCrop && (await getStorage().exists(heading.evidence.currentCrop))).toBe(true);
  });

  it("generates an Excel report with all required columns and evidence", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const { buildExcelReport } = await import("../../core/reports/excel");
    const buf = await buildExcelReport(comparisonId, "http://localhost:3000");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as any);
    expect(wb.worksheets.map((w) => w.name)).toEqual(expect.arrayContaining(["Summary", "Pages", "Changes"]));
    const ws = wb.getWorksheet("Changes")!;
    const headers = (ws.getRow(1).values as string[]).filter(Boolean);
    for (const h of ["Page name", "URL", "Device", "Category", "Severity", "Description", "Expected / baseline result", "Actual / current result", "Steps to reproduce / verify", "Before evidence", "After evidence", "Review status", "Page comparison status"]) {
      expect(headers).toContain(h);
    }
    const visible = changes.filter((c) => c.reviewStatus !== "ignored");
    expect(ws.rowCount - 1).toBe(visible.length);
    const summary = wb.getWorksheet("Summary")!;
    const text = JSON.stringify(summary.getSheetValues());
    expect(text).toContain("Fixture");
    expect(text).toContain("v1");
    expect((wb.model as any).media?.length ?? 0).toBeGreaterThan(0); // embedded evidence crops
  }, 60_000);

  it("generates a PDF report", async () => {
    const { buildPdfReport } = await import("../../core/reports/pdf");
    const buf = await buildPdfReport(comparisonId);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(20_000);
    const pages = (buf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length;
    expect(pages).toBeGreaterThan(3);
  }, 60_000);

  it("review workflow + 'always ignore' rules suppress the change in later comparisons", async () => {
    const repo = getRepo();
    const target = on("/products").find((c) => c.category === "content")!;
    const reviewed = await repo.reviewChange(target.id, "ignored", "price change expected");
    expect(reviewed.reviewStatus).toBe("ignored");
    await repo.addIgnoreRule(reviewed.id ? (await repo.getComparison(comparisonId))!.websiteId : 0, target.fingerprint, "price");
    const cmp = (await repo.getComparison(comparisonId))!;
    const res = await run(await repo.enqueueJob("recompare", cmp.websiteId, { baselineRunId: cmp.baselineRunId, currentRunId: cmp.currentRunId }));
    const again = await repo.listChanges(res.comparisonId as number, { includeIgnored: true });
    const same = again.find((c) => c.fingerprint === target.fingerprint)!;
    expect(same.reviewStatus).toBe("ignored");
    expect(same.autoIgnored).toBe(true);
    const visible = await repo.listChanges(res.comparisonId as number);
    expect(visible.some((c) => c.fingerprint === target.fingerprint)).toBe(false);
  }, 120_000);
});
