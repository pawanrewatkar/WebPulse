import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";

const SITE = "http://localhost:4400";

test.describe.configure({ mode: "serial" });

let websiteUrl = "";

async function waitForJob(page: Page, timeout = 240_000) {
  // JobProgress shows a status badge; wait until it is completed (or fail fast on failure).
  const status = page.getByTestId("job-status");
  await expect(status).toBeVisible();
  await expect(status).toHaveAttribute("data-status", /^(completed|failed|cancelled)$/, { timeout });
  await expect(status).toHaveAttribute("data-status", "completed");
}

test.beforeAll(async ({ request }) => {
  await request.post(`${SITE}/__admin/version?v=1`);
});

test("dashboard loads and shows the worker is online", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByText("Worker online")).toBeVisible({ timeout: 20_000 });
});

test("rejects SSRF targets when adding a website", async ({ page }) => {
  await page.goto("/websites/new");
  await page.getByLabel("Name").fill("Metadata attack");
  await page.getByLabel("Base URL").fill("http://169.254.169.254/latest/meta-data");
  await page.getByRole("button", { name: "Create website" }).click();
  await expect(page.getByText(/private\/internal address/)).toBeVisible();
});

test("add website and save a baseline (desktop + mobile)", async ({ page }) => {
  await page.goto("/websites/new");
  await page.getByLabel("Name").fill("Fixture Shop");
  await page.getByLabel("Base URL").fill(SITE);
  await page.getByLabel("Max pages").fill("15");
  await page.getByLabel("Delay between pages (ms)").fill("0");
  await page.getByLabel("Page timeout (ms)").fill("5000");
  await page.getByLabel("Retries").fill("0");
  await page.getByLabel("Settle wait (ms)").fill("100");
  await page.getByRole("button", { name: "Create website" }).click();
  await expect(page.getByRole("heading", { name: "Fixture Shop" })).toBeVisible();
  websiteUrl = page.url();

  await page.getByRole("button", { name: "Save Website" }).click();
  await waitForJob(page);
  await page.reload();
  const row = page.locator("tr", { hasText: "v1" }).first();
  await expect(row.getByText("active")).toBeVisible();
  await expect(row.getByText("completed")).toBeVisible();
});

test("Baseline Explorer shows stored captures for both devices without crawling", async ({ page }) => {
  await page.goto(websiteUrl);
  await page.getByRole("main").getByRole("link", { name: "Baseline Explorer" }).click();
  await expect(page.getByRole("heading", { name: "Baseline Explorer" })).toBeVisible();
  await page.getByRole("list", { name: "Captured pages" }).getByRole("button", { name: /\/products/ }).click();

  await expect(page.getByRole("img", { name: /Screenshot of .*\/products \(desktop\)/ })).toBeVisible();
  await page.getByRole("tab", { name: "Content" }).click();
  await expect(page.getByText("Widget A").first()).toBeVisible();
  await expect(page.getByText("Price: $29")).toBeVisible();
  await page.getByRole("tab", { name: "Images" }).click();
  await expect(page.getByText(/widget-b\.svg/)).toBeVisible();
  await page.getByRole("tab", { name: "Metadata" }).click();
  await expect(page.getByRole("row", { name: "Title Products – Acme", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Links" }).click();
  await expect(page.getByRole("cell", { name: "Partner site" })).toBeVisible();
  await page.getByRole("tab", { name: "Sections" }).click();
  await expect(page.locator("text=<main>").first()).toBeVisible();
  await page.getByRole("tab", { name: "DOM" }).click();
  await expect(page.getByText("Structure outline")).toBeVisible();

  await page.getByRole("group", { name: "Device" }).getByRole("button", { name: "mobile" }).click();
  await page.getByRole("tab", { name: "Screenshots" }).click();
  await expect(page.getByRole("img", { name: /Screenshot of .*\/products \(mobile\)/ })).toBeVisible();
});

test("compare website after changes: removed vs crawl-failed, review, reports", async ({ page, request }) => {
  await request.post(`${SITE}/__admin/version?v=2`);
  await page.goto(websiteUrl);
  await page.getByRole("button", { name: "Compare Website" }).click();
  await waitForJob(page);
  await page.getByRole("link", { name: /Open comparison results/ }).click();
  await expect(page.getByRole("heading", { name: /Comparison #\d+/ })).toBeVisible();

  const summary = page.locator("table").first();
  await expect(summary.locator("tr", { hasText: "/about" }).first().getByText("Removed (404/410)")).toBeVisible();
  await expect(summary.locator("tr", { hasText: "/slow" }).first().getByText("Crawl failed – not verified")).toBeVisible();
  await expect(page.getByText(/could not be loaded during the current crawl/).first()).toBeVisible();

  // Filter to the home page CTA change and review it.
  await page.getByLabel("Category").selectOption("cta");
  const item = page.getByTestId("change-item").filter({ hasText: 'Button/CTA "Contact Sales" removed' }).first();
  await expect(item).toBeVisible();
  await item.getByRole("button", { name: "Confirm" }).click();
  await expect(item.locator(".badge", { hasText: "confirmed" })).toBeVisible();

  // Reports
  const [xlsx] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download Excel" }).click()]);
  expect(xlsx.suggestedFilename()).toMatch(/\.xlsx$/);
  const xlsxPath = await xlsx.path();
  expect(fs.statSync(xlsxPath!).size).toBeGreaterThan(5000);
  const [pdf] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download PDF" }).click()]);
  expect(pdf.suggestedFilename()).toMatch(/\.pdf$/);
  expect(fs.readFileSync((await pdf.path())!).subarray(0, 5).toString()).toBe("%PDF-");
});

test("manual comparison in the explorer: baseline page vs comparison capture", async ({ page }) => {
  await page.goto("/comparisons");
  await page.getByRole("link", { name: /^#\d+$/ }).first().click();
  await page.getByRole("link", { name: "Open in Explorer" }).click();
  await page.getByRole("list", { name: "Captured pages" }).getByRole("button", { name: /\/products/ }).click();
  await expect(page.getByText(/difference\(s\)/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Image changed (\"Widget B\"): different image URL")).toBeVisible();
  await expect(page.getByRole("img", { name: /Selected capture/ })).toBeVisible();
  await expect(page.getByRole("img", { name: /Compared capture/ })).toBeVisible();
});

test("version history: new baseline needs confirmation, old version can be restored", async ({ page }) => {
  await page.goto(websiteUrl);
  await page.getByRole("button", { name: "Save Website" }).click();
  await expect(page.getByRole("dialog")).toContainText("not overwritten");
  await page.getByRole("button", { name: /Yes, create v2/ }).click();
  await waitForJob(page);
  await page.reload();
  await expect(page.locator("tr", { hasText: "v2" }).first().getByText("active")).toBeVisible();

  page.once("dialog", (d) => d.accept());
  await page.locator("tr", { hasText: "v1" }).first().getByRole("button", { name: "Restore as active" }).click();
  await expect(page.locator("tr", { hasText: "v1" }).first().getByText("active")).toBeVisible();
  // v2 is kept in history. It is "partial" because /slow times out in fixture v2 – reported honestly, not hidden.
  const v2 = page.locator("tr", { hasText: "v2" }).first();
  await expect(v2.getByText("partial")).toBeVisible();
  await expect(v2.getByText("2 page capture(s) failed")).toBeVisible();
  await expect(v2.getByRole("button", { name: "Restore as active" })).toBeVisible();
});
