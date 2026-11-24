import { getRepo } from "../db";
import { DEVICE_PROFILES } from "../devices";
import type { Change, Comparison, CrawlRun, PageSummary, Website } from "../types";

export interface ReportModel {
  website: Website;
  comparison: Comparison;
  baseline: CrawlRun;
  current: CrawlRun;
  changes: Change[]; // reportable (not ignored)
  ignored: Change[];
  pages: PageSummary[];
  generatedAt: string;
}

export const PAGE_STATUS_TEXT: Record<string, string> = {
  unchanged: "Unchanged",
  changed: "Changed",
  new_page: "New page",
  removed: "Removed (HTTP 404/410)",
  http_error: "HTTP error",
  crawl_failed: "Crawl failed – not verified",
  not_checked: "Not checked",
};

export const REVIEW_TEXT: Record<string, string> = {
  pending: "Pending review",
  confirmed: "Confirmed",
  ignored: "Ignored",
  flagged: "Flagged",
};

export async function loadReportModel(comparisonId: number): Promise<ReportModel> {
  const repo = getRepo();
  const comparison = await repo.getComparison(comparisonId);
  if (!comparison) throw new Error("Comparison not found");
  if (comparison.status !== "completed" || !comparison.summary) throw new Error("Comparison has not completed – no report can be generated");
  const [website, baseline, current, all] = await Promise.all([
    repo.getWebsite(comparison.websiteId),
    repo.getRun(comparison.baselineRunId),
    repo.getRun(comparison.currentRunId),
    repo.listChanges(comparisonId, { includeIgnored: true }),
  ]);
  if (!website || !baseline || !current) throw new Error("Comparison references missing data");
  const sevOrder = { critical: 0, high: 1, medium: 2, low: 3 } as const;
  const sorted = [...all].sort((a, b) => a.urlKey.localeCompare(b.urlKey) || a.device.localeCompare(b.device) || sevOrder[a.severity] - sevOrder[b.severity] || a.id - b.id);
  return {
    website,
    comparison,
    baseline,
    current,
    changes: sorted.filter((c) => c.reviewStatus !== "ignored"),
    ignored: sorted.filter((c) => c.reviewStatus === "ignored"),
    pages: comparison.summary.pages,
    generatedAt: new Date().toISOString(),
  };
}

/** Human-readable steps to reproduce / verify a change. Derived only from recorded data. */
export function stepsToVerify(c: Change): string {
  const dev = DEVICE_PROFILES[c.device]?.label ?? c.device;
  const steps: string[] = [`Open ${c.url} in a browser at ${dev}${c.device === "mobile" ? " (mobile emulation)" : ""}.`];
  switch (c.category) {
    case "page":
      steps.push(c.changeType === "potentially_broken" && /could not be loaded/.test(c.description)
        ? "Check whether the page loads within a reasonable time (the crawler could not load it)."
        : "Check the HTTP status code of the page (browser dev tools → Network).");
      break;
    case "visual": {
      const regions = c.evidence.regions?.slice(0, 3).map((r) => `y≈${r.y}px`).join(", ");
      steps.push(`Scroll through the page${regions ? ` (changed regions at ${regions})` : ""} and compare with the baseline screenshot.`);
      break;
    }
    case "metadata":
      steps.push("Inspect the page <head> (View Source) and check the relevant tag.");
      break;
    case "link":
      if (c.changeType === "potentially_broken") steps.push(`Click the link${c.selector ? ` (${c.selector})` : ""} and confirm the target URL's HTTP status.`);
      else steps.push(`Locate the link${c.selector ? ` (${c.selector})` : ""} and check its text and target.`);
      break;
    case "image":
      steps.push(`Locate the image${c.selector ? ` (${c.selector})` : ""} and check it displays the expected file.`);
      break;
    case "responsive":
      steps.push("Check whether the page scrolls horizontally / content is cut off at this viewport width.");
      break;
    case "structure":
      steps.push("Inspect the DOM (dev tools → Elements) and compare with the baseline structure in the Baseline Explorer.");
      break;
    default:
      steps.push(`Locate the element${c.selector ? ` "${c.selector}"` : ""} on the page.`);
  }
  if (c.expected) steps.push(`Expected (baseline): ${truncate(c.expected, 200)}`);
  if (c.actual) steps.push(`Actual (current): ${truncate(c.actual, 200)}`);
  return steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export function pageName(c: { pageTitle: string | null; url: string }): string {
  if (c.pageTitle) return c.pageTitle;
  try {
    return new URL(c.url).pathname;
  } catch {
    return c.url;
  }
}
