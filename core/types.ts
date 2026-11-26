import type { WebsiteSettings } from "./settings";

export type Device = "desktop" | "mobile";
export const DEVICES: Device[] = ["desktop", "mobile"];

export type RunKind = "baseline" | "comparison" | "capture";
export type RunStatus = "queued" | "running" | "completed" | "partial" | "failed" | "cancelled";
export type PageStatus = "captured" | "http_error" | "failed";

export type JobType = "baseline" | "compare" | "capture" | "recompare";
export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type ChangeCategory =
  | "page"
  | "visual"
  | "content"
  | "heading"
  | "cta"
  | "image"
  | "link"
  | "metadata"
  | "section"
  | "structure"
  | "form"
  | "responsive";
export type ChangeType = "added" | "removed" | "modified" | "potentially_broken";
export type Severity = "critical" | "high" | "medium" | "low";
export type ReviewStatus = "pending" | "confirmed" | "ignored" | "flagged";

/** Per-page outcome of a comparison, used for page-wise summaries and the report "Comparison status". */
export type PageComparisonStatus =
  | "unchanged"
  | "changed"
  | "new_page"
  | "removed"
  | "http_error"
  | "crawl_failed"
  | "not_checked";

export interface Website {
  id: number;
  name: string;
  baseUrl: string;
  settings: WebsiteSettings;
  hasCredentials: boolean;
  credentialsUsername: string | null;
  activeBaselineId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CrawlRun {
  id: number;
  websiteId: number;
  kind: RunKind;
  version: number | null;
  label: string | null;
  status: RunStatus;
  devices: Device[];
  stats: RunStats;
  error: string | null;
  jobId: number | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface RunStats {
  discovered?: number;
  pagesPlanned?: number;
  captured?: number;
  failed?: number;
  httpErrors?: number;
  duplicatesSkipped?: number;
  linksChecked?: number;
  brokenLinks?: number;
  durationMs?: number;
}

export interface PageCapture {
  id: number;
  runId: number;
  url: string;
  urlKey: string;
  device: Device;
  status: PageStatus;
  httpStatus: number | null;
  finalUrl: string | null;
  error: string | null;
  title: string | null;
  screenshotPath: string | null;
  thumbPath: string | null;
  domPath: string | null;
  dataPath: string | null;
  screenshotWidth: number | null;
  screenshotHeight: number | null;
  contentHash: string | null;
  loadMs: number | null;
  attempts: number;
  capturedAt: string;
}

export interface LinkCheck {
  runId: number;
  url: string;
  status: number | null;
  ok: boolean;
  error: string | null;
}

export interface Comparison {
  id: number;
  websiteId: number;
  baselineRunId: number;
  currentRunId: number;
  status: "running" | "completed" | "failed";
  summary: ComparisonSummary | null;
  error: string | null;
  jobId: number | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface PageSummary {
  url: string;
  urlKey: string;
  device: Device;
  title: string | null;
  status: PageComparisonStatus;
  baselinePageId: number | null;
  currentPageId: number | null;
  changeCount: number;
  bySeverity: Partial<Record<Severity, number>>;
  visualDiffPercent: number | null;
  note?: string;
}

export interface ComparisonSummary {
  totalChanges: number;
  autoIgnored: number;
  byCategory: Partial<Record<ChangeCategory, number>>;
  bySeverity: Partial<Record<Severity, number>>;
  byType: Partial<Record<ChangeType, number>>;
  pages: PageSummary[];
  pagesCompared: number;
  pagesChanged: number;
  pagesUnchanged: number;
  pagesNew: number;
  pagesRemoved: number;
  pagesFailed: number;
  pagesNotChecked: number;
  /** Broken links that were already broken in the baseline (not counted as changes). */
  existingBrokenLinks?: Array<{ url: string; status: number | null; error: string | null }>;
}

export interface ChangeEvidence {
  baselineScreenshot?: string | null;
  currentScreenshot?: string | null;
  diffImage?: string | null;
  baselineCrop?: string | null;
  currentCrop?: string | null;
  regions?: Array<{ x: number; y: number; width: number; height: number }>;
  /** Position of the changed element on the baseline / current screenshot (page pixels), used for highlighting. */
  beforeBox?: Box | null;
  afterBox?: Box | null;
  diffPercent?: number;
  baselinePageId?: number | null;
  currentPageId?: number | null;
  details?: string[];
}

export interface Change {
  id: number;
  comparisonId: number;
  url: string;
  urlKey: string;
  device: Device;
  pageTitle: string | null;
  category: ChangeCategory;
  changeType: ChangeType;
  severity: Severity;
  description: string;
  expected: string | null;
  actual: string | null;
  selector: string | null;
  evidence: ChangeEvidence;
  fingerprint: string;
  reviewStatus: ReviewStatus;
  reviewNote: string | null;
  autoIgnored: boolean;
  reviewedAt: string | null;
}

export type NewChange = Omit<Change, "id" | "comparisonId" | "reviewStatus" | "reviewNote" | "reviewedAt" | "autoIgnored">;

export interface Job {
  id: number;
  type: JobType;
  websiteId: number | null;
  payload: Record<string, unknown>;
  status: JobStatus;
  progress: number;
  message: string | null;
  error: string | null;
  result: Record<string, unknown> | null;
  cancelRequested: boolean;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  heartbeatAt: string | null;
}

export interface JobLog {
  id: number;
  jobId: number;
  ts: string;
  level: string;
  message: string;
}

export interface IgnoreRule {
  id: number;
  websiteId: number;
  fingerprint: string;
  description: string | null;
  createdAt: string;
}

/** Element bounding box in page coordinates: [x, y, width, height]. */
export type Box = [number, number, number, number];

/** Data extracted from a rendered page (stored as data.json next to the screenshot). */
export interface PageData {
  url: string;
  finalUrl: string;
  title: string;
  lang: string;
  meta: {
    description: string;
    keywords: string;
    robots: string;
    canonical: string;
    viewport: string;
    og: Record<string, string>;
    twitter: Record<string, string>;
  };
  headings: Array<{ level: number; text: string; selector: string; box?: Box }>;
  textBlocks: Array<{ tag: string; text: string; selector: string; box?: Box }>;
  buttons: Array<{ text: string; tag: string; href: string | null; selector: string; box?: Box }>;
  images: Array<{
    src: string;
    alt: string;
    width: number;
    height: number;
    naturalWidth: number;
    naturalHeight: number;
    loaded: boolean;
    selector: string;
    box?: Box;
  }>;
  links: Array<{ href: string; text: string; rel: string; target: string; selector: string; box?: Box }>;
  sections: Array<{
    tag: string;
    id: string;
    classes: string;
    role: string;
    heading: string;
    textLength: number;
    textSample: string;
    top: number;
    height: number;
    selector: string;
    box?: Box;
  }>;
  forms: Array<{ action: string; method: string; selector: string; box?: Box; fields: Array<{ name: string; type: string; label: string }> }>;
  iframes: string[];
  domStats: { elementCount: number; maxDepth: number; tagCounts: Record<string, number> };
  outline: string[];
  layout: {
    scrollWidth: number;
    scrollHeight: number;
    viewportWidth: number;
    viewportHeight: number;
    horizontalOverflow: boolean;
  };
}
