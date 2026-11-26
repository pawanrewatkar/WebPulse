import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { decryptString, encryptString } from "../security/crypto";
import { parseSettings } from "../settings";
import type { ChangeFilter, Credentials, Repository } from "./repository";
import type { Change, Comparison, CrawlRun, IgnoreRule, Job, JobLog, LinkCheck, PageCapture, Website } from "../types";

const MIGRATIONS: string[] = [
  /* 1: initial schema */ `
  CREATE TABLE websites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    settings TEXT NOT NULL DEFAULT '{}',
    credentials_enc TEXT,
    credentials_username TEXT,
    active_baseline_id INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE crawl_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    website_id INTEGER NOT NULL REFERENCES websites(id),
    kind TEXT NOT NULL CHECK (kind IN ('baseline','comparison','capture')),
    version INTEGER,
    label TEXT,
    status TEXT NOT NULL,
    devices TEXT NOT NULL,
    settings_snapshot TEXT NOT NULL,
    stats TEXT NOT NULL DEFAULT '{}',
    error TEXT,
    job_id INTEGER,
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    UNIQUE (website_id, kind, version)
  );
  CREATE INDEX idx_runs_website ON crawl_runs(website_id, kind);
  CREATE TABLE pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL REFERENCES crawl_runs(id),
    url TEXT NOT NULL,
    url_key TEXT NOT NULL,
    device TEXT NOT NULL,
    status TEXT NOT NULL,
    http_status INTEGER,
    final_url TEXT,
    error TEXT,
    title TEXT,
    screenshot_path TEXT,
    thumb_path TEXT,
    dom_path TEXT,
    data_path TEXT,
    screenshot_width INTEGER,
    screenshot_height INTEGER,
    content_hash TEXT,
    load_ms INTEGER,
    attempts INTEGER NOT NULL DEFAULT 1,
    captured_at TEXT NOT NULL,
    UNIQUE (run_id, url_key, device)
  );
  CREATE TABLE link_checks (
    run_id INTEGER NOT NULL REFERENCES crawl_runs(id),
    url TEXT NOT NULL,
    status INTEGER,
    ok INTEGER NOT NULL,
    error TEXT,
    PRIMARY KEY (run_id, url)
  );
  CREATE TABLE comparisons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    website_id INTEGER NOT NULL REFERENCES websites(id),
    baseline_run_id INTEGER NOT NULL REFERENCES crawl_runs(id),
    current_run_id INTEGER NOT NULL REFERENCES crawl_runs(id),
    status TEXT NOT NULL,
    summary TEXT,
    error TEXT,
    job_id INTEGER,
    created_at TEXT NOT NULL,
    finished_at TEXT
  );
  CREATE TABLE changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    comparison_id INTEGER NOT NULL REFERENCES comparisons(id),
    url TEXT NOT NULL,
    url_key TEXT NOT NULL,
    device TEXT NOT NULL,
    page_title TEXT,
    category TEXT NOT NULL,
    change_type TEXT NOT NULL,
    severity TEXT NOT NULL,
    description TEXT NOT NULL,
    expected TEXT,
    actual TEXT,
    selector TEXT,
    evidence TEXT NOT NULL DEFAULT '{}',
    fingerprint TEXT NOT NULL,
    review_status TEXT NOT NULL DEFAULT 'pending',
    review_note TEXT,
    auto_ignored INTEGER NOT NULL DEFAULT 0,
    reviewed_at TEXT
  );
  CREATE INDEX idx_changes_cmp ON changes(comparison_id);
  CREATE TABLE ignore_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    website_id INTEGER NOT NULL REFERENCES websites(id),
    fingerprint TEXT NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (website_id, fingerprint)
  );
  CREATE TABLE jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    website_id INTEGER,
    payload TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL,
    progress REAL NOT NULL DEFAULT 0,
    message TEXT,
    error TEXT,
    result TEXT,
    cancel_requested INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    heartbeat_at TEXT
  );
  CREATE INDEX idx_jobs_status ON jobs(status, id);
  CREATE TABLE job_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL REFERENCES jobs(id),
    ts TEXT NOT NULL,
    level TEXT NOT NULL,
    message TEXT NOT NULL
  );
  CREATE INDEX idx_job_logs ON job_logs(job_id, id);
  CREATE TABLE workers (
    id TEXT PRIMARY KEY,
    pid INTEGER,
    current_job_id INTEGER,
    started_at TEXT NOT NULL,
    beat_at TEXT NOT NULL
  );
  `,
];

const now = () => new Date().toISOString();
const j = <T>(s: string | null | undefined, fallback: T): T => {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

type Row = Record<string, any>;

function toWebsite(r: Row): Website {
  return {
    id: r.id,
    name: r.name,
    baseUrl: r.base_url,
    settings: parseSettings(j(r.settings, {})),
    hasCredentials: !!r.credentials_enc,
    credentialsUsername: r.credentials_username ?? null,
    activeBaselineId: r.active_baseline_id ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
function toRun(r: Row): CrawlRun {
  return {
    id: r.id,
    websiteId: r.website_id,
    kind: r.kind,
    version: r.version ?? null,
    label: r.label ?? null,
    status: r.status,
    devices: j(r.devices, []),
    stats: j(r.stats, {}),
    error: r.error ?? null,
    jobId: r.job_id ?? null,
    createdAt: r.created_at,
    startedAt: r.started_at ?? null,
    finishedAt: r.finished_at ?? null,
  };
}
function toPage(r: Row): PageCapture {
  return {
    id: r.id,
    runId: r.run_id,
    url: r.url,
    urlKey: r.url_key,
    device: r.device,
    status: r.status,
    httpStatus: r.http_status ?? null,
    finalUrl: r.final_url ?? null,
    error: r.error ?? null,
    title: r.title ?? null,
    screenshotPath: r.screenshot_path ?? null,
    thumbPath: r.thumb_path ?? null,
    domPath: r.dom_path ?? null,
    dataPath: r.data_path ?? null,
    screenshotWidth: r.screenshot_width ?? null,
    screenshotHeight: r.screenshot_height ?? null,
    contentHash: r.content_hash ?? null,
    loadMs: r.load_ms ?? null,
    attempts: r.attempts,
    capturedAt: r.captured_at,
  };
}
function toComparison(r: Row): Comparison {
  return {
    id: r.id,
    websiteId: r.website_id,
    baselineRunId: r.baseline_run_id,
    currentRunId: r.current_run_id,
    status: r.status,
    summary: j(r.summary, null),
    error: r.error ?? null,
    jobId: r.job_id ?? null,
    createdAt: r.created_at,
    finishedAt: r.finished_at ?? null,
  };
}
function toChange(r: Row): Change {
  return {
    id: r.id,
    comparisonId: r.comparison_id,
    url: r.url,
    urlKey: r.url_key,
    device: r.device,
    pageTitle: r.page_title ?? null,
    category: r.category,
    changeType: r.change_type,
    severity: r.severity,
    description: r.description,
    expected: r.expected ?? null,
    actual: r.actual ?? null,
    selector: r.selector ?? null,
    evidence: j(r.evidence, {}),
    fingerprint: r.fingerprint,
    reviewStatus: r.review_status,
    reviewNote: r.review_note ?? null,
    autoIgnored: !!r.auto_ignored,
    reviewedAt: r.reviewed_at ?? null,
  };
}
function toJob(r: Row): Job {
  return {
    id: r.id,
    type: r.type,
    websiteId: r.website_id ?? null,
    payload: j(r.payload, {}),
    status: r.status,
    progress: r.progress,
    message: r.message ?? null,
    error: r.error ?? null,
    result: j(r.result, null),
    cancelRequested: !!r.cancel_requested,
    createdAt: r.created_at,
    startedAt: r.started_at ?? null,
    finishedAt: r.finished_at ?? null,
    heartbeatAt: r.heartbeat_at ?? null,
  };
}

/** Builds "col = @col" SET clauses from a camelCase patch, skipping undefined values. */
function buildSet(patch: Record<string, unknown>, map: Record<string, string>, jsonKeys: string[] = []) {
  const sets: string[] = [];
  const params: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || !map[k]) continue;
    sets.push(`${map[k]} = @${k}`);
    params[k] = jsonKeys.includes(k) && v !== null ? JSON.stringify(v) : typeof v === "boolean" ? (v ? 1 : 0) : v;
  }
  return { sets, params };
}

export class SqliteRepository implements Repository {
  private db: Database.Database;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  private migrate() {
    const current = this.db.pragma("user_version", { simple: true }) as number;
    for (let i = current; i < MIGRATIONS.length; i++) {
      this.db.transaction(() => {
        this.db.exec(MIGRATIONS[i]);
        this.db.pragma(`user_version = ${i + 1}`);
      })();
    }
  }

  close() {
    this.db.close();
  }

  // ---------------- Websites ----------------
  async listWebsites() {
    return this.db.prepare("SELECT * FROM websites ORDER BY name COLLATE NOCASE").all().map((r) => toWebsite(r as Row));
  }
  async getWebsite(id: number) {
    const r = this.db.prepare("SELECT * FROM websites WHERE id = ?").get(id) as Row | undefined;
    return r ? toWebsite(r) : null;
  }
  async createWebsite(input: { name: string; baseUrl: string; settings: any; credentials?: Credentials | null }) {
    const t = now();
    const info = this.db
      .prepare(
        `INSERT INTO websites (name, base_url, settings, credentials_enc, credentials_username, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.name,
        input.baseUrl,
        JSON.stringify(input.settings),
        input.credentials ? encryptString(JSON.stringify(input.credentials)) : null,
        input.credentials?.username ?? null,
        t,
        t,
      );
    return (await this.getWebsite(Number(info.lastInsertRowid)))!;
  }
  async updateWebsite(id: number, patch: { name?: string; baseUrl?: string; settings?: any; credentials?: Credentials | null }) {
    const sets: string[] = ["updated_at = @updatedAt"];
    const params: Record<string, unknown> = { id, updatedAt: now() };
    if (patch.name !== undefined) (sets.push("name = @name"), (params.name = patch.name));
    if (patch.baseUrl !== undefined) (sets.push("base_url = @baseUrl"), (params.baseUrl = patch.baseUrl));
    if (patch.settings !== undefined) (sets.push("settings = @settings"), (params.settings = JSON.stringify(patch.settings)));
    if (patch.credentials !== undefined) {
      sets.push("credentials_enc = @cred", "credentials_username = @credUser");
      params.cred = patch.credentials ? encryptString(JSON.stringify(patch.credentials)) : null;
      params.credUser = patch.credentials?.username ?? null;
    }
    this.db.prepare(`UPDATE websites SET ${sets.join(", ")} WHERE id = @id`).run(params);
    const w = await this.getWebsite(id);
    if (!w) throw new Error(`Website ${id} not found`);
    return w;
  }
  async getWebsiteCredentials(id: number): Promise<Credentials | null> {
    const r = this.db.prepare("SELECT credentials_enc FROM websites WHERE id = ?").get(id) as Row | undefined;
    if (!r?.credentials_enc) return null;
    return JSON.parse(decryptString(r.credentials_enc));
  }
  async setActiveBaseline(websiteId: number, runId: number | null) {
    if (runId !== null) {
      const run = await this.getRun(runId);
      if (!run || run.websiteId !== websiteId || run.kind !== "baseline") throw new Error("Not a baseline of this website");
      if (run.status !== "completed" && run.status !== "partial") throw new Error("Only finished baselines can be activated");
    }
    this.db.prepare("UPDATE websites SET active_baseline_id = ?, updated_at = ? WHERE id = ?").run(runId, now(), websiteId);
  }

  async deleteWebsite(id: number) {
    return this.db.transaction(() => {
      const ids = (sql: string) => (this.db.prepare(sql).all(id) as Row[]).map((r) => r.id as number);
      const runIds = ids("SELECT id FROM crawl_runs WHERE website_id = ?");
      const comparisonIds = ids("SELECT id FROM comparisons WHERE website_id = ?");
      const pageIds = ids("SELECT p.id FROM pages p JOIN crawl_runs r ON r.id = p.run_id WHERE r.website_id = ?");
      // Children first (foreign keys are enforced).
      this.db.prepare("DELETE FROM changes WHERE comparison_id IN (SELECT id FROM comparisons WHERE website_id = ?)").run(id);
      this.db.prepare("DELETE FROM comparisons WHERE website_id = ?").run(id);
      this.db.prepare("DELETE FROM link_checks WHERE run_id IN (SELECT id FROM crawl_runs WHERE website_id = ?)").run(id);
      this.db.prepare("DELETE FROM pages WHERE run_id IN (SELECT id FROM crawl_runs WHERE website_id = ?)").run(id);
      this.db.prepare("UPDATE websites SET active_baseline_id = NULL WHERE id = ?").run(id);
      this.db.prepare("DELETE FROM crawl_runs WHERE website_id = ?").run(id);
      this.db.prepare("DELETE FROM ignore_rules WHERE website_id = ?").run(id);
      this.db.prepare("DELETE FROM job_logs WHERE job_id IN (SELECT id FROM jobs WHERE website_id = ?)").run(id);
      this.db.prepare("DELETE FROM jobs WHERE website_id = ?").run(id);
      this.db.prepare("DELETE FROM websites WHERE id = ?").run(id);
      return { runIds, comparisonIds, pageIds };
    })();
  }

  // ---------------- Runs ----------------
  async createRun(input: { websiteId: number; kind: CrawlRun["kind"]; label?: string | null; devices: string[]; jobId?: number | null; settingsSnapshot: any }) {
    const id = this.db.transaction(() => {
      let version: number | null = null;
      if (input.kind === "baseline") {
        const r = this.db
          .prepare("SELECT COALESCE(MAX(version), 0) + 1 AS v FROM crawl_runs WHERE website_id = ? AND kind = 'baseline'")
          .get(input.websiteId) as Row;
        version = r.v;
      }
      const info = this.db
        .prepare(
          `INSERT INTO crawl_runs (website_id, kind, version, label, status, devices, settings_snapshot, job_id, created_at)
           VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?)`,
        )
        .run(input.websiteId, input.kind, version, input.label ?? null, JSON.stringify(input.devices), JSON.stringify(input.settingsSnapshot), input.jobId ?? null, now());
      return Number(info.lastInsertRowid);
    })();
    return (await this.getRun(id))!;
  }
  async updateRun(id: number, patch: Record<string, unknown>) {
    const { sets, params } = buildSet(
      patch,
      { status: "status", stats: "stats", error: "error", startedAt: "started_at", finishedAt: "finished_at", label: "label" },
      ["stats"],
    );
    if (!sets.length) return;
    this.db.prepare(`UPDATE crawl_runs SET ${sets.join(", ")} WHERE id = @id`).run({ ...params, id });
  }
  async getRun(id: number) {
    const r = this.db.prepare("SELECT * FROM crawl_runs WHERE id = ?").get(id) as Row | undefined;
    return r ? toRun(r) : null;
  }
  async listRuns(websiteId: number, kind?: CrawlRun["kind"]) {
    const rows = kind
      ? this.db.prepare("SELECT * FROM crawl_runs WHERE website_id = ? AND kind = ? ORDER BY id DESC").all(websiteId, kind)
      : this.db.prepare("SELECT * FROM crawl_runs WHERE website_id = ? ORDER BY id DESC").all(websiteId);
    return rows.map((r) => toRun(r as Row));
  }

  // ---------------- Pages ----------------
  async savePage(p: Omit<PageCapture, "id">) {
    this.db
      .prepare(
        `INSERT INTO pages (run_id, url, url_key, device, status, http_status, final_url, error, title, screenshot_path, thumb_path,
           dom_path, data_path, screenshot_width, screenshot_height, content_hash, load_ms, attempts, captured_at)
         VALUES (@runId, @url, @urlKey, @device, @status, @httpStatus, @finalUrl, @error, @title, @screenshotPath, @thumbPath,
           @domPath, @dataPath, @screenshotWidth, @screenshotHeight, @contentHash, @loadMs, @attempts, @capturedAt)
         ON CONFLICT (run_id, url_key, device) DO UPDATE SET
           status = excluded.status, http_status = excluded.http_status, final_url = excluded.final_url, error = excluded.error,
           title = excluded.title, screenshot_path = excluded.screenshot_path, thumb_path = excluded.thumb_path,
           dom_path = excluded.dom_path, data_path = excluded.data_path, screenshot_width = excluded.screenshot_width,
           screenshot_height = excluded.screenshot_height, content_hash = excluded.content_hash, load_ms = excluded.load_ms,
           attempts = excluded.attempts, captured_at = excluded.captured_at`,
      )
      .run(p);
    const r = this.db.prepare("SELECT * FROM pages WHERE run_id = ? AND url_key = ? AND device = ?").get(p.runId, p.urlKey, p.device) as Row;
    return toPage(r);
  }
  async listPages(runId: number) {
    return this.db.prepare("SELECT * FROM pages WHERE run_id = ? ORDER BY url_key, device").all(runId).map((r) => toPage(r as Row));
  }
  async getPage(id: number) {
    const r = this.db.prepare("SELECT * FROM pages WHERE id = ?").get(id) as Row | undefined;
    return r ? toPage(r) : null;
  }

  // ---------------- Link checks ----------------
  async saveLinkChecks(runId: number, checks: Omit<LinkCheck, "runId">[]) {
    const stmt = this.db.prepare(
      "INSERT OR REPLACE INTO link_checks (run_id, url, status, ok, error) VALUES (?, ?, ?, ?, ?)",
    );
    this.db.transaction(() => {
      for (const c of checks) stmt.run(runId, c.url, c.status, c.ok ? 1 : 0, c.error);
    })();
  }
  async listLinkChecks(runId: number) {
    return this.db
      .prepare("SELECT * FROM link_checks WHERE run_id = ?")
      .all(runId)
      .map((r: any) => ({ runId: r.run_id, url: r.url, status: r.status ?? null, ok: !!r.ok, error: r.error ?? null }));
  }

  // ---------------- Comparisons ----------------
  async createComparison(input: { websiteId: number; baselineRunId: number; currentRunId: number; jobId?: number | null }) {
    const info = this.db
      .prepare(
        "INSERT INTO comparisons (website_id, baseline_run_id, current_run_id, status, job_id, created_at) VALUES (?, ?, ?, 'running', ?, ?)",
      )
      .run(input.websiteId, input.baselineRunId, input.currentRunId, input.jobId ?? null, now());
    return (await this.getComparison(Number(info.lastInsertRowid)))!;
  }
  async updateComparison(id: number, patch: Record<string, unknown>) {
    const { sets, params } = buildSet(patch, { status: "status", summary: "summary", error: "error", finishedAt: "finished_at" }, ["summary"]);
    if (!sets.length) return;
    this.db.prepare(`UPDATE comparisons SET ${sets.join(", ")} WHERE id = @id`).run({ ...params, id });
  }
  async getComparison(id: number) {
    const r = this.db.prepare("SELECT * FROM comparisons WHERE id = ?").get(id) as Row | undefined;
    return r ? toComparison(r) : null;
  }
  async listComparisons(websiteId?: number) {
    const rows =
      websiteId === undefined
        ? this.db.prepare("SELECT * FROM comparisons ORDER BY id DESC LIMIT 200").all()
        : this.db.prepare("SELECT * FROM comparisons WHERE website_id = ? ORDER BY id DESC").all(websiteId);
    return rows.map((r) => toComparison(r as Row));
  }
  async insertChanges(comparisonId: number, changes: any[]) {
    const stmt = this.db.prepare(
      `INSERT INTO changes (comparison_id, url, url_key, device, page_title, category, change_type, severity, description,
         expected, actual, selector, evidence, fingerprint, review_status, auto_ignored)
       VALUES (@comparisonId, @url, @urlKey, @device, @pageTitle, @category, @changeType, @severity, @description,
         @expected, @actual, @selector, @evidence, @fingerprint, @reviewStatus, @autoIgnored)`,
    );
    this.db.transaction(() => {
      for (const c of changes) {
        stmt.run({
          comparisonId,
          url: c.url,
          urlKey: c.urlKey,
          device: c.device,
          pageTitle: c.pageTitle ?? null,
          category: c.category,
          changeType: c.changeType,
          severity: c.severity,
          description: c.description,
          expected: c.expected ?? null,
          actual: c.actual ?? null,
          selector: c.selector ?? null,
          evidence: JSON.stringify(c.evidence ?? {}),
          fingerprint: c.fingerprint,
          reviewStatus: c.reviewStatus ?? "pending",
          autoIgnored: c.autoIgnored ? 1 : 0,
        });
      }
    })();
  }
  async listChanges(comparisonId: number, f: ChangeFilter = {}) {
    const where = ["comparison_id = @comparisonId"];
    const params: Record<string, unknown> = { comparisonId };
    if (f.device) (where.push("device = @device"), (params.device = f.device));
    if (f.category) (where.push("category = @category"), (params.category = f.category));
    if (f.severity) (where.push("severity = @severity"), (params.severity = f.severity));
    if (f.reviewStatus) (where.push("review_status = @reviewStatus"), (params.reviewStatus = f.reviewStatus));
    if (f.urlKey) (where.push("url_key = @urlKey"), (params.urlKey = f.urlKey));
    if (!f.includeIgnored && !f.reviewStatus) where.push("review_status != 'ignored'");
    const sql = `SELECT * FROM changes WHERE ${where.join(" AND ")}
      ORDER BY url_key, device,
        CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, id`;
    return this.db.prepare(sql).all(params).map((r) => toChange(r as Row));
  }
  async getChange(id: number) {
    const r = this.db.prepare("SELECT * FROM changes WHERE id = ?").get(id) as Row | undefined;
    return r ? toChange(r) : null;
  }
  async reviewChange(id: number, status: Change["reviewStatus"], note?: string | null) {
    this.db
      .prepare("UPDATE changes SET review_status = ?, review_note = COALESCE(?, review_note), reviewed_at = ? WHERE id = ?")
      .run(status, note ?? null, now(), id);
    const c = await this.getChange(id);
    if (!c) throw new Error(`Change ${id} not found`);
    return c;
  }

  // ---------------- Ignore rules ----------------
  async listIgnoreRules(websiteId: number): Promise<IgnoreRule[]> {
    return this.db
      .prepare("SELECT * FROM ignore_rules WHERE website_id = ? ORDER BY id DESC")
      .all(websiteId)
      .map((r: any) => ({ id: r.id, websiteId: r.website_id, fingerprint: r.fingerprint, description: r.description, createdAt: r.created_at }));
  }
  async addIgnoreRule(websiteId: number, fingerprint: string, description: string | null) {
    this.db
      .prepare("INSERT OR IGNORE INTO ignore_rules (website_id, fingerprint, description, created_at) VALUES (?, ?, ?, ?)")
      .run(websiteId, fingerprint, description, now());
  }
  async deleteIgnoreRule(id: number) {
    this.db.prepare("DELETE FROM ignore_rules WHERE id = ?").run(id);
  }

  // ---------------- Jobs ----------------
  async enqueueJob(type: Job["type"], websiteId: number | null, payload: Record<string, unknown>) {
    const info = this.db
      .prepare("INSERT INTO jobs (type, website_id, payload, status, created_at) VALUES (?, ?, ?, 'queued', ?)")
      .run(type, websiteId, JSON.stringify(payload), now());
    return (await this.getJob(Number(info.lastInsertRowid)))!;
  }
  async getJob(id: number) {
    const r = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Row | undefined;
    return r ? toJob(r) : null;
  }
  async listJobs(opts: { websiteId?: number; limit?: number; status?: Job["status"][] } = {}) {
    const where: string[] = [];
    const params: unknown[] = [];
    if (opts.websiteId !== undefined) (where.push("website_id = ?"), params.push(opts.websiteId));
    if (opts.status?.length) (where.push(`status IN (${opts.status.map(() => "?").join(",")})`), params.push(...opts.status));
    const sql = `SELECT * FROM jobs ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id DESC LIMIT ${Math.min(opts.limit ?? 100, 500)}`;
    return this.db.prepare(sql).all(...params).map((r) => toJob(r as Row));
  }
  async claimNextJob() {
    const t = now();
    const r = this.db
      .prepare(
        `UPDATE jobs SET status = 'running', started_at = ?, heartbeat_at = ?, message = 'Started'
         WHERE id = (SELECT id FROM jobs WHERE status = 'queued' AND cancel_requested = 0 ORDER BY id LIMIT 1) AND status = 'queued'
         RETURNING *`,
      )
      .get(t, t) as Row | undefined;
    // Queued jobs cancelled before they started are closed out here.
    this.db
      .prepare("UPDATE jobs SET status = 'cancelled', finished_at = ?, message = 'Cancelled before start' WHERE status = 'queued' AND cancel_requested = 1")
      .run(t);
    return r ? toJob(r) : null;
  }
  async claimJob(id: number) {
    const t = now();
    const r = this.db
      .prepare("UPDATE jobs SET status = 'running', started_at = ?, heartbeat_at = ?, message = 'Started' WHERE id = ? AND status = 'queued' RETURNING *")
      .get(t, t, id) as Row | undefined;
    return r ? toJob(r) : null;
  }
  async updateJob(id: number, patch: Record<string, unknown>) {
    const { sets, params } = buildSet(
      patch,
      { status: "status", progress: "progress", message: "message", error: "error", result: "result", finishedAt: "finished_at" },
      ["result"],
    );
    if (!sets.length) return;
    this.db.prepare(`UPDATE jobs SET ${sets.join(", ")}, heartbeat_at = @hb WHERE id = @id`).run({ ...params, id, hb: now() });
  }
  async heartbeatJob(id: number) {
    this.db.prepare("UPDATE jobs SET heartbeat_at = ? WHERE id = ?").run(now(), id);
  }
  async requestJobCancel(id: number) {
    this.db.prepare("UPDATE jobs SET cancel_requested = 1 WHERE id = ? AND status IN ('queued','running')").run(id);
  }
  async isJobCancelRequested(id: number) {
    const r = this.db.prepare("SELECT cancel_requested FROM jobs WHERE id = ?").get(id) as Row | undefined;
    return !!r?.cancel_requested;
  }
  async addJobLog(jobId: number, level: string, message: string) {
    this.db.prepare("INSERT INTO job_logs (job_id, ts, level, message) VALUES (?, ?, ?, ?)").run(jobId, now(), level, message.slice(0, 4000));
  }
  async listJobLogs(jobId: number, afterId = 0): Promise<JobLog[]> {
    return this.db
      .prepare("SELECT * FROM job_logs WHERE job_id = ? AND id > ? ORDER BY id LIMIT 2000")
      .all(jobId, afterId)
      .map((r: any) => ({ id: r.id, jobId: r.job_id, ts: r.ts, level: r.level, message: r.message }));
  }
  async failStaleJobs(staleMs: number) {
    const cutoff = new Date(Date.now() - staleMs).toISOString();
    const rows = this.db
      .prepare(
        `UPDATE jobs SET status = 'failed', finished_at = ?, error = 'Worker stopped or crashed while this job was running (no heartbeat). Re-run the job.'
         WHERE status = 'running' AND (heartbeat_at IS NULL OR heartbeat_at < ?) RETURNING id`,
      )
      .all(now(), cutoff) as Row[];
    return rows.map((r) => r.id as number);
  }
  async workerBeat(workerId: string, pid: number, currentJobId: number | null) {
    const t = now();
    this.db
      .prepare(
        `INSERT INTO workers (id, pid, current_job_id, started_at, beat_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET current_job_id = excluded.current_job_id, beat_at = excluded.beat_at`,
      )
      .run(workerId, pid, currentJobId, t, t);
  }
  async workerStopped(workerId: string) {
    this.db.prepare("DELETE FROM workers WHERE id = ?").run(workerId);
  }
  async listLiveWorkers(maxAgeMs: number) {
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
    return this.db
      .prepare("SELECT * FROM workers WHERE beat_at >= ?")
      .all(cutoff)
      .map((r: any) => ({ id: r.id, pid: r.pid, currentJobId: r.current_job_id ?? null, startedAt: r.started_at, beatAt: r.beat_at }));
  }
  async hasActiveJob(websiteId: number) {
    const r = this.db
      .prepare("SELECT * FROM jobs WHERE website_id = ? AND status IN ('queued','running') ORDER BY id LIMIT 1")
      .get(websiteId) as Row | undefined;
    return r ? toJob(r) : null;
  }
}
