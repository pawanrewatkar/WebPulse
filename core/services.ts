import { z } from "zod";
import { getRepo } from "./db";
import { getStorage, storageKeys } from "./storage";
import { authSettingsSchema, parseSettings, websiteSettingsSchema } from "./settings";
import { assertSafeUrl, normalizeUrl, UrlValidationError } from "./security/url";
import type { Device, Job, Website } from "./types";

export class ServiceError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export const websiteInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  baseUrl: z.string().trim().min(1, "Base URL is required"),
  settings: websiteSettingsSchema.partial().optional(),
  auth: authSettingsSchema.partial({ usernameSelector: true, passwordSelector: true, submitSelector: true }).nullable().optional(),
  /** Write-only. undefined = keep existing, null = remove, object = replace. */
  credentials: z
    .object({ username: z.string().min(1), password: z.string().min(1) })
    .nullable()
    .optional(),
});
export type WebsiteInput = z.infer<typeof websiteInputSchema>;

function zodMessage(err: z.ZodError) {
  return err.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
}

async function validateBaseUrl(raw: string) {
  try {
    const u = await assertSafeUrl(raw);
    return normalizeUrl(u.toString());
  } catch (e) {
    if (e instanceof UrlValidationError) throw new ServiceError(e.message);
    throw e;
  }
}

export async function createWebsite(raw: unknown): Promise<Website> {
  const parsed = websiteInputSchema.safeParse(raw);
  if (!parsed.success) throw new ServiceError(zodMessage(parsed.error));
  const input = parsed.data;
  const baseUrl = await validateBaseUrl(input.baseUrl);
  const settings = buildSettings(input.settings ?? {}, input.auth);
  if (settings.auth) await validateBaseUrl(settings.auth.loginUrl);
  return getRepo().createWebsite({ name: input.name, baseUrl, settings, credentials: input.credentials ?? null });
}

export async function updateWebsite(id: number, raw: unknown): Promise<Website> {
  const repo = getRepo();
  const existing = await repo.getWebsite(id);
  if (!existing) throw new ServiceError("Website not found", 404);
  const parsed = websiteInputSchema.partial().safeParse(raw);
  if (!parsed.success) throw new ServiceError(zodMessage(parsed.error));
  const input = parsed.data;
  const baseUrl = input.baseUrl !== undefined ? await validateBaseUrl(input.baseUrl) : undefined;
  let settings = undefined;
  if (input.settings !== undefined || input.auth !== undefined) {
    const merged = { ...existing.settings, ...(input.settings ?? {}) };
    settings = buildSettings(merged, input.auth === undefined ? existing.settings.auth : input.auth);
    if (settings.auth) await validateBaseUrl(settings.auth.loginUrl);
  }
  return repo.updateWebsite(id, { name: input.name, baseUrl, settings, credentials: input.credentials });
}

function buildSettings(partial: Record<string, unknown>, auth: unknown) {
  const clean = (arr: unknown) =>
    Array.isArray(arr) ? arr.map((s) => String(s).trim()).filter(Boolean) : undefined;
  const s: Record<string, unknown> = { ...partial };
  for (const k of ["includeUrls", "excludePatterns", "allowedDomains", "ignoreSelectors", "ignoreTextPatterns"]) {
    if (s[k] !== undefined) s[k] = clean(s[k]);
  }
  const authObj = auth && typeof auth === "object" && (auth as any).loginUrl ? auth : null;
  try {
    return parseSettings({ ...s, auth: authObj });
  } catch (e) {
    if (e instanceof z.ZodError) throw new ServiceError(zodMessage(e));
    throw e;
  }
}

async function ensureNoActiveJob(websiteId: number) {
  const active = await getRepo().hasActiveJob(websiteId);
  if (active) throw new ServiceError(`A ${active.type} job is already ${active.status} for this website. Wait for it to finish or cancel it.`, 409);
}

async function requireWebsite(id: number) {
  const w = await getRepo().getWebsite(id);
  if (!w) throw new ServiceError("Website not found", 404);
  return w;
}

/** "Save Website": queues a crawl that creates a new, versioned baseline. Existing baselines are never modified. */
export async function startBaseline(websiteId: number, opts: { label?: string; setActive?: boolean; confirmNewVersion?: boolean } = {}): Promise<Job> {
  const w = await requireWebsite(websiteId);
  const repo = getRepo();
  const baselines = await repo.listRuns(websiteId, "baseline");
  if (w.activeBaselineId && opts.setActive !== false && !opts.confirmNewVersion) {
    throw new ServiceError(
      "An active baseline already exists. Confirm to create a new baseline version (existing versions are kept and can be restored).",
      409,
    );
  }
  await ensureNoActiveJob(websiteId);
  return repo.enqueueJob("baseline", websiteId, {
    label: opts.label?.slice(0, 120) || `Baseline v${(baselines[0]?.version ?? 0) + 1}`,
    setActive: opts.setActive !== false,
  });
}

/** "Compare Website": queues a fresh crawl and a comparison against the selected (or active) baseline. */
export async function startCompare(websiteId: number, baselineRunId?: number): Promise<Job> {
  const w = await requireWebsite(websiteId);
  const repo = getRepo();
  const baselineId = baselineRunId ?? w.activeBaselineId;
  if (!baselineId) throw new ServiceError("No baseline selected and no active baseline. Save the website first.");
  const run = await repo.getRun(baselineId);
  if (!run || run.websiteId !== websiteId || run.kind !== "baseline") throw new ServiceError("Invalid baseline");
  if (run.status !== "completed" && run.status !== "partial") throw new ServiceError("Selected baseline did not finish successfully");
  await ensureNoActiveJob(websiteId);
  return repo.enqueueJob("compare", websiteId, { baselineRunId: baselineId });
}

/** Re-runs the comparison engine on two existing runs (no crawl). */
export async function startRecompare(websiteId: number, baselineRunId: number, currentRunId: number): Promise<Job> {
  await requireWebsite(websiteId);
  const repo = getRepo();
  const [a, b] = await Promise.all([repo.getRun(baselineRunId), repo.getRun(currentRunId)]);
  if (!a || !b || a.websiteId !== websiteId || b.websiteId !== websiteId) throw new ServiceError("Invalid runs");
  return repo.enqueueJob("recompare", websiteId, { baselineRunId, currentRunId });
}

/** Ad-hoc capture of specific URLs (used by the Baseline Explorer for manual "current" comparisons). */
export async function startCapture(websiteId: number, urls: string[], devices?: Device[]): Promise<Job> {
  const w = await requireWebsite(websiteId);
  if (!urls.length) throw new ServiceError("No URLs given");
  if (urls.length > 50) throw new ServiceError("At most 50 URLs per capture");
  const clean: string[] = [];
  for (const u of urls) {
    try {
      clean.push(normalizeUrl(u, w.baseUrl));
    } catch {
      throw new ServiceError(`Invalid URL: ${u}`);
    }
  }
  await ensureNoActiveJob(websiteId);
  return getRepo().enqueueJob("capture", websiteId, { urls: clean, devices: devices ?? w.settings.devices });
}

export async function restoreBaseline(websiteId: number, runId: number) {
  await requireWebsite(websiteId);
  try {
    await getRepo().setActiveBaseline(websiteId, runId);
  } catch (e) {
    throw new ServiceError((e as Error).message);
  }
}

/**
 * Permanently deletes a website with all its baselines, comparisons, captures and reports.
 * Requires the exact website name as confirmation and no running/queued job for the site.
 */
export async function deleteWebsite(websiteId: number, confirmName: string): Promise<{ deletedRuns: number; deletedComparisons: number }> {
  const w = await requireWebsite(websiteId);
  if ((confirmName ?? "").trim() !== w.name.trim()) throw new ServiceError("Confirmation does not match the website name. Nothing was deleted.");
  const active = await getRepo().hasActiveJob(websiteId);
  if (active) throw new ServiceError(`A ${active.type} job is ${active.status} for this website. Cancel it or wait for it to finish before deleting.`, 409);

  const { runIds, comparisonIds, pageIds } = await getRepo().deleteWebsite(websiteId);

  // Stored files: best effort after the database rows are gone (a leftover file is harmless, a dangling row is not).
  const storage = getStorage();
  const pageSet = new Set(pageIds.map(String));
  const removals: Promise<void>[] = [
    ...runIds.map((id) => storage.remove(`runs/${id}`)),
    ...comparisonIds.flatMap((id) => [storage.remove(storageKeys.comparison(id)), storage.remove(storageKeys.report(id, "xlsx")), storage.remove(storageKeys.report(id, "pdf"))]),
  ];
  for (const dir of await storage.list("manual")) {
    const [a, b] = dir.split("-");
    if (pageSet.has(a) || pageSet.has(b)) removals.push(storage.remove(`manual/${dir}`));
  }
  await Promise.allSettled(removals);
  return { deletedRuns: runIds.length, deletedComparisons: comparisonIds.length };
}

/** Shape sent to the browser: never includes credentials. */
export function publicWebsite(w: Website) {
  return w;
}
