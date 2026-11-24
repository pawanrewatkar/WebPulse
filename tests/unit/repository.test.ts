import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { useTempDataDir } from "../helpers";
import { getRepo } from "../../core/db";
import { createWebsite, startBaseline, startCompare, updateWebsite, ServiceError } from "../../core/services";

let env: ReturnType<typeof useTempDataDir>;
beforeAll(() => {
  env = useTempDataDir();
});
afterAll(() => env.cleanup());

describe("website management", () => {
  it("creates a website with defaults and encrypted credentials", async () => {
    const w = await createWebsite({
      name: "Fixture",
      baseUrl: "http://localhost:4400/",
      auth: { loginUrl: "http://localhost:4400/login" },
      credentials: { username: "qa", password: "hunter2" },
    });
    expect(w.settings.devices).toEqual(["desktop", "mobile"]);
    expect(w.hasCredentials).toBe(true);
    expect(JSON.stringify(w)).not.toContain("hunter2");
    const raw = fs.readFileSync(path.join(env.dir, "app.db"));
    expect(raw.includes(Buffer.from("hunter2"))).toBe(false);
    expect(await getRepo().getWebsiteCredentials(w.id)).toEqual({ username: "qa", password: "hunter2" });
  });

  it("rejects private targets that are not allow-listed and invalid URLs", async () => {
    await expect(createWebsite({ name: "x", baseUrl: "http://192.168.0.10/" })).rejects.toBeInstanceOf(ServiceError);
    await expect(createWebsite({ name: "x", baseUrl: "not a url" })).rejects.toBeInstanceOf(ServiceError);
  });

  it("updates settings and keeps credentials unless replaced", async () => {
    const w = await createWebsite({ name: "Two", baseUrl: "http://localhost:4400", credentials: { username: "a", password: "b" } });
    const u = await updateWebsite(w.id, { settings: { maxPages: 7, excludePatterns: [" */logout* ", ""] } });
    expect(u.settings.maxPages).toBe(7);
    expect(u.settings.excludePatterns).toEqual(["*/logout*"]);
    expect(u.hasCredentials).toBe(true);
  });
});

describe("jobs & baselines", () => {
  it("queues a baseline, prevents duplicates, and requires confirmation for new versions", async () => {
    const w = await createWebsite({ name: "Three", baseUrl: "http://localhost:4400" });
    const job = await startBaseline(w.id);
    expect(job.status).toBe("queued");
    await expect(startBaseline(w.id)).rejects.toThrow(/already/);

    const repo = getRepo();
    const claimed = await repo.claimNextJob();
    expect(claimed?.id).toBe(job.id);
    expect(claimed?.status).toBe("running");
    await repo.updateJob(job.id, { status: "completed" });
    await expect(startCompare(w.id)).rejects.toThrow(/baseline/i);

    const run1 = await repo.createRun({ websiteId: w.id, kind: "baseline", devices: ["desktop"], settingsSnapshot: w.settings });
    const run2 = await repo.createRun({ websiteId: w.id, kind: "baseline", devices: ["desktop"], settingsSnapshot: w.settings });
    expect([run1.version, run2.version]).toEqual([1, 2]);
    await expect(repo.setActiveBaseline(w.id, run1.id)).rejects.toThrow(/finished/);
    await repo.updateRun(run1.id, { status: "completed" });
    await repo.setActiveBaseline(w.id, run1.id);
    await expect(startBaseline(w.id)).rejects.toThrow(/Confirm/);
    const j2 = await startBaseline(w.id, { confirmNewVersion: true });
    expect(j2.payload.setActive).toBe(true);
  });

  it("fails stale running jobs", async () => {
    const repo = getRepo();
    const j = await repo.enqueueJob("baseline", null, {});
    // drain any other queued job first
    let claimed;
    do claimed = await repo.claimNextJob();
    while (claimed && claimed.id !== j.id);
    const ids = await repo.failStaleJobs(-1000);
    expect(ids).toContain(j.id);
    expect((await repo.getJob(j.id))?.status).toBe("failed");
  });
});
