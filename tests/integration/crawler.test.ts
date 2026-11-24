import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { useTempDataDir } from "../helpers";
import { startFixtureServer, type FixtureServer } from "../fixtures/site-server";
import { getRepo } from "../../core/db";
import { createWebsite } from "../../core/services";
import { runJob } from "../../core/jobs/handlers";
import { createCliContext } from "../../core/jobs/context";
import { getStorage } from "../../core/storage";
import type { Job, PageData } from "../../core/types";

const PORT = 4411;
let env: ReturnType<typeof useTempDataDir>;
let site: FixtureServer;

const fastSettings = { pageTimeoutMs: 5000, retries: 0, crawlDelayMs: 0, waitAfterLoadMs: 100, maxPages: 20 };

async function runQueuedJob(job: Job) {
  const repo = getRepo();
  const claimed = await repo.claimNextJob();
  expect(claimed?.id).toBe(job.id);
  return runJob(createCliContext(claimed!));
}

beforeAll(async () => {
  env = useTempDataDir();
  site = await startFixtureServer(PORT, 1);
});
afterAll(async () => {
  await site.close();
  env.cleanup();
});

describe("crawler: public website baseline", () => {
  it("discovers pages via sitemap + links, captures desktop & mobile, extracts content, stays on-domain", async () => {
    const repo = getRepo();
    const w = await createWebsite({ name: "Fixture", baseUrl: site.url, settings: fastSettings });
    const job = await repo.enqueueJob("baseline", w.id, { label: "first", setActive: true });
    const result = await runQueuedJob(job);
    expect(result.version).toBe(1);

    const run = (await repo.getRun(result.runId as number))!;
    expect(run.status).toBe("completed");
    expect((await repo.getWebsite(w.id))!.activeBaselineId).toBe(run.id);

    const pages = await repo.listPages(run.id);
    const paths = [...new Set(pages.map((p) => new URL(p.url).pathname))].sort();
    // /blog/first-post and /slow are only reachable via sitemap or deep links; /privacy via footer link.
    expect(paths).toEqual(expect.arrayContaining(["/", "/about", "/products", "/contact", "/blog/first-post", "/slow", "/privacy"]));
    expect(pages.some((p) => p.url.includes("example.org"))).toBe(false); // external domain never crawled

    for (const device of ["desktop", "mobile"] as const) {
      const home = pages.find((p) => p.device === device && new URL(p.url).pathname === "/")!;
      expect(home.status).toBe("captured");
      expect(home.httpStatus).toBe(200);
      const png = await getStorage().read(home.screenshotPath!);
      expect(png.subarray(1, 4).toString()).toBe("PNG");
      expect(home.screenshotWidth).toBe(device === "desktop" ? 1440 : 390);
      const data = JSON.parse(await getStorage().readText(home.dataPath!)) as PageData;
      expect(data.title).toBe("Acme Widgets – Home");
      expect(data.headings.map((h) => h.text)).toContain("Welcome to Acme Widgets");
      expect(data.buttons.map((b) => b.text)).toEqual(expect.arrayContaining(["Get Started", "Contact Sales"]));
      expect(data.images.find((i) => i.src.endsWith("/img/hero.svg"))?.loaded).toBe(true);
      expect(data.meta.description).toContain("quality widgets");
      expect(data.sections.some((s) => s.id === "hero")).toBe(true);
      expect(data.outline.length).toBeGreaterThan(5);
      expect(data.textBlocks.some((t) => t.text.includes("reliable widgets"))).toBe(true);
      expect(fs.existsSync(getStorage().resolve(home.domPath!))).toBe(true);
    }

    // The account page redirects to /login when not authenticated: captured as the login page, not an error.
    const checks = await repo.listLinkChecks(run.id);
    expect(checks.find((c) => c.url.endsWith("/partner"))).toBeUndefined(); // external links not checked by default
    expect(checks.every((c) => c.ok)).toBe(true);
  }, 180_000);

  it("creates a new version on re-save without touching the previous baseline", async () => {
    const repo = getRepo();
    const w = (await repo.listWebsites()).find((x) => x.name === "Fixture")!;
    const v1 = (await repo.listRuns(w.id, "baseline"))[0];
    const v1Pages = await repo.listPages(v1.id);
    await repo.updateWebsite(w.id, { settings: { ...w.settings, devices: ["desktop"], maxPages: 2, useSitemap: false, checkLinks: false } });
    const job = await repo.enqueueJob("baseline", w.id, { setActive: false });
    const result = await runQueuedJob(job);
    expect(result.version).toBe(2);
    expect((await repo.getWebsite(w.id))!.activeBaselineId).toBe(v1.id); // setActive false keeps v1 active
    expect(await repo.listPages(v1.id)).toEqual(v1Pages); // v1 untouched
  }, 120_000);
});

describe("crawler: login-protected website", () => {
  it("logs in with stored credentials and captures protected pages", async () => {
    const repo = getRepo();
    const w = await createWebsite({
      name: "Fixture (auth)",
      baseUrl: site.url,
      settings: { ...fastSettings, devices: ["desktop"], useSitemap: false, followLinks: false, includeUrls: ["/account", "/account/orders"], checkLinks: false },
      auth: { loginUrl: `${site.url}/login`, usernameSelector: "#username", passwordSelector: "#password", submitSelector: "button[type=submit]", failureUrlPattern: "*/login*" },
      credentials: { username: "qa", password: "secret123" },
    });
    const job = await repo.enqueueJob("baseline", w.id, { setActive: true });
    const result = await runQueuedJob(job);
    const pages = await repo.listPages(result.runId as number);
    const account = pages.find((p) => p.url.endsWith("/account"))!;
    expect(account.status).toBe("captured");
    const data = JSON.parse(await getStorage().readText(account.dataPath!)) as PageData;
    expect(data.headings[0].text).toBe("Welcome back, QA");
    expect(pages.find((p) => p.url.endsWith("/account/orders"))?.status).toBe("captured");

    // Logs must not contain the password
    const logs = await repo.listJobLogs(job.id);
    expect(JSON.stringify(logs)).not.toContain("secret123");
  }, 120_000);

  it("fails clearly with wrong credentials (no pages reported)", async () => {
    const repo = getRepo();
    const w = await createWebsite({
      name: "Fixture (bad auth)",
      baseUrl: site.url,
      settings: { ...fastSettings, devices: ["desktop"], useSitemap: false, followLinks: false, includeUrls: ["/account"] },
      auth: { loginUrl: `${site.url}/login`, usernameSelector: "#username", passwordSelector: "#password", submitSelector: "button[type=submit]" },
      credentials: { username: "qa", password: "wrong" },
    });
    const job = await repo.enqueueJob("baseline", w.id, {});
    await expect(runQueuedJob(job)).rejects.toThrow(/Login/);
    const run = (await repo.listRuns(w.id, "baseline"))[0];
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(/Login/);
    expect((await repo.getWebsite(w.id))!.activeBaselineId).toBeNull();
  }, 60_000);
});
