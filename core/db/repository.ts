import type {
  Change,
  ChangeCategory,
  Comparison,
  ComparisonSummary,
  CrawlRun,
  Device,
  IgnoreRule,
  Job,
  JobLog,
  JobStatus,
  JobType,
  LinkCheck,
  NewChange,
  PageCapture,
  ReviewStatus,
  RunKind,
  RunStats,
  RunStatus,
  Severity,
  Website,
} from "../types";
import type { WebsiteSettings } from "../settings";

/**
 * Database abstraction. All persistence goes through this interface so the SQLite implementation
 * can be replaced by a PostgreSQL (Supabase) implementation without touching the rest of the code.
 * Methods are async even though better-sqlite3 is synchronous, to match a network database.
 */
export interface Repository {
  // Websites
  listWebsites(): Promise<Website[]>;
  getWebsite(id: number): Promise<Website | null>;
  createWebsite(input: { name: string; baseUrl: string; settings: WebsiteSettings; credentials?: Credentials | null }): Promise<Website>;
  updateWebsite(
    id: number,
    patch: { name?: string; baseUrl?: string; settings?: WebsiteSettings; credentials?: Credentials | null },
  ): Promise<Website>;
  /** Decrypted credentials. Internal use by the crawler only, never sent to the client. */
  getWebsiteCredentials(id: number): Promise<Credentials | null>;
  setActiveBaseline(websiteId: number, runId: number | null): Promise<void>;
  /**
   * Permanently deletes a website and everything recorded for it (runs, pages, link checks,
   * comparisons, changes, ignore rules, jobs, job logs). Returns ids needed to clean up stored files.
   */
  deleteWebsite(id: number): Promise<{ runIds: number[]; comparisonIds: number[]; pageIds: number[] }>;

  // Crawl runs (baselines, comparison crawls, ad-hoc captures)
  createRun(input: { websiteId: number; kind: RunKind; label?: string | null; devices: Device[]; jobId?: number | null; settingsSnapshot: WebsiteSettings }): Promise<CrawlRun>;
  updateRun(id: number, patch: { status?: RunStatus; stats?: RunStats; error?: string | null; startedAt?: string; finishedAt?: string; label?: string | null }): Promise<void>;
  getRun(id: number): Promise<CrawlRun | null>;
  listRuns(websiteId: number, kind?: RunKind): Promise<CrawlRun[]>;

  // Pages
  savePage(page: Omit<PageCapture, "id">): Promise<PageCapture>;
  listPages(runId: number): Promise<PageCapture[]>;
  getPage(id: number): Promise<PageCapture | null>;

  // Link checks
  saveLinkChecks(runId: number, checks: Omit<LinkCheck, "runId">[]): Promise<void>;
  listLinkChecks(runId: number): Promise<LinkCheck[]>;

  // Comparisons & changes
  createComparison(input: { websiteId: number; baselineRunId: number; currentRunId: number; jobId?: number | null }): Promise<Comparison>;
  updateComparison(id: number, patch: { status?: Comparison["status"]; summary?: ComparisonSummary; error?: string | null; finishedAt?: string }): Promise<void>;
  getComparison(id: number): Promise<Comparison | null>;
  listComparisons(websiteId?: number): Promise<Comparison[]>;
  insertChanges(comparisonId: number, changes: Array<NewChange & { reviewStatus?: ReviewStatus; autoIgnored?: boolean }>): Promise<void>;
  listChanges(comparisonId: number, filter?: ChangeFilter): Promise<Change[]>;
  getChange(id: number): Promise<Change | null>;
  reviewChange(id: number, status: ReviewStatus, note?: string | null): Promise<Change>;

  // Ignore rules (fingerprints of changes the user chose to always ignore)
  listIgnoreRules(websiteId: number): Promise<IgnoreRule[]>;
  addIgnoreRule(websiteId: number, fingerprint: string, description: string | null): Promise<void>;
  deleteIgnoreRule(id: number): Promise<void>;

  // Jobs
  enqueueJob(type: JobType, websiteId: number | null, payload: Record<string, unknown>): Promise<Job>;
  getJob(id: number): Promise<Job | null>;
  listJobs(opts?: { websiteId?: number; limit?: number; status?: JobStatus[] }): Promise<Job[]>;
  claimNextJob(): Promise<Job | null>;
  /** Claims a specific queued job (used by the CLI to run a job inline). */
  claimJob(id: number): Promise<Job | null>;
  updateJob(id: number, patch: { status?: JobStatus; progress?: number; message?: string | null; error?: string | null; result?: Record<string, unknown> | null; finishedAt?: string }): Promise<void>;
  heartbeatJob(id: number): Promise<void>;
  requestJobCancel(id: number): Promise<void>;
  isJobCancelRequested(id: number): Promise<boolean>;
  addJobLog(jobId: number, level: string, message: string): Promise<void>;
  listJobLogs(jobId: number, afterId?: number): Promise<JobLog[]>;
  /** Marks running jobs whose heartbeat is older than staleMs as failed. Returns affected job ids. */
  failStaleJobs(staleMs: number): Promise<number[]>;
  hasActiveJob(websiteId: number): Promise<Job | null>;

  // Worker liveness
  workerBeat(workerId: string, pid: number, currentJobId: number | null): Promise<void>;
  workerStopped(workerId: string): Promise<void>;
  listLiveWorkers(maxAgeMs: number): Promise<Array<{ id: string; pid: number; currentJobId: number | null; startedAt: string; beatAt: string }>>;

  close(): void;
}

export interface Credentials {
  username: string;
  password: string;
}

export interface ChangeFilter {
  device?: Device;
  category?: ChangeCategory;
  severity?: Severity;
  reviewStatus?: ReviewStatus;
  urlKey?: string;
  includeIgnored?: boolean;
}
