import ExcelJS from "exceljs";
import { getStorage } from "../storage";
import { loadReportModel, PAGE_STATUS_TEXT, pageName, REVIEW_TEXT, stepsToVerify, type ReportModel } from "./model";
import type { Change } from "../types";

const SEVERITY_FILL: Record<string, string> = { critical: "FFFECACA", high: "FFFED7AA", medium: "FFFEF08A", low: "FFE5E7EB" };
const MAX_EMBEDDED_IMAGES = 200;

/**
 * Builds the Excel report. `appOrigin` (e.g. http://localhost:3000) turns evidence references into
 * clickable links; storage keys are always included so evidence can be located on disk.
 */
export async function buildExcelReport(comparisonId: number, appOrigin?: string): Promise<Buffer> {
  const m = await loadReportModel(comparisonId);
  const wb = new ExcelJS.Workbook();
  wb.creator = "Website Change Monitor";
  wb.created = new Date();

  summarySheet(wb, m);
  pagesSheet(wb, m);
  await changesSheet(wb, "Changes", m.changes, m, appOrigin, true);
  if (m.ignored.length) await changesSheet(wb, "Ignored changes", m.ignored, m, appOrigin, false);
  const existing = m.comparison.summary?.existingBrokenLinks ?? [];
  if (existing.length) {
    const ws = wb.addWorksheet("Existing issues");
    ws.columns = [
      { header: "Broken link (already broken in baseline)", key: "url", width: 80 },
      { header: "Result", key: "status", width: 20 },
    ];
    for (const l of existing) ws.addRow({ url: l.url, status: l.status ? `HTTP ${l.status}` : l.error ?? "request failed" });
    header(ws);
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

function header(ws: ExcelJS.Worksheet) {
  const row = ws.getRow(1);
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };
  row.alignment = { vertical: "middle", wrapText: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
}

function summarySheet(wb: ExcelJS.Workbook, m: ReportModel) {
  const ws = wb.addWorksheet("Summary");
  ws.columns = [{ width: 34 }, { width: 70 }];
  const s = m.comparison.summary!;
  const rows: [string, string | number][] = [
    ["Website", m.website.name],
    ["Base URL", m.website.baseUrl],
    ["Baseline version", `v${m.baseline.version}${m.baseline.label ? ` – ${m.baseline.label}` : ""}`],
    ["Baseline captured", m.baseline.finishedAt ?? m.baseline.createdAt],
    ["Comparison date (current crawl)", m.current.finishedAt ?? m.current.createdAt],
    ["Current crawl status", `${m.current.status}${m.current.error ? ` – ${m.current.error}` : ""}`],
    ["Devices", m.current.devices.join(", ")],
    ["Report generated", m.generatedAt],
    ["", ""],
    ["Total changes (not ignored)", s.totalChanges],
    ["Ignored changes", m.ignored.length],
    ["Critical", s.bySeverity.critical ?? 0],
    ["High", s.bySeverity.high ?? 0],
    ["Medium", s.bySeverity.medium ?? 0],
    ["Low", s.bySeverity.low ?? 0],
    ["", ""],
    ["Page views compared", s.pagesCompared],
    ["Page views changed", s.pagesChanged],
    ["Page views unchanged", s.pagesUnchanged],
    ["New pages", s.pagesNew],
    ["Removed pages (HTTP 404/410)", s.pagesRemoved],
    ["Crawl failures (NOT verified, not reported as removed)", s.pagesFailed],
    ["Not checked", s.pagesNotChecked],
    ["", ""],
    ...Object.entries(s.byCategory).map(([k, v]) => [`Category: ${k}`, v ?? 0] as [string, number]),
    ...Object.entries(s.byType).map(([k, v]) => [`Type: ${k.replace("_", " ")}`, v ?? 0] as [string, number]),
  ];
  ws.addRow(["Website change report", ""]).font = { bold: true, size: 14 };
  for (const r of rows) {
    const row = ws.addRow(r);
    row.getCell(1).font = { bold: true };
  }
  ws.addRow([]);
  ws.addRow(["Note", "Pages that failed to load are reported as 'Crawl failed – not verified'. They were not confirmed as removed. All results come from an actual crawl; no result is inferred."]).getCell(2).alignment = { wrapText: true };
}

function pagesSheet(wb: ExcelJS.Workbook, m: ReportModel) {
  const ws = wb.addWorksheet("Pages");
  ws.columns = [
    { header: "Page name", key: "title", width: 34 },
    { header: "URL", key: "url", width: 50 },
    { header: "Device", key: "device", width: 10 },
    { header: "Comparison status", key: "status", width: 26 },
    { header: "Changes", key: "count", width: 10 },
    { header: "Critical", key: "critical", width: 9 },
    { header: "High", key: "high", width: 9 },
    { header: "Medium", key: "medium", width: 9 },
    { header: "Low", key: "low", width: 9 },
    { header: "Visual diff %", key: "visual", width: 13 },
    { header: "Note", key: "note", width: 60 },
  ];
  for (const p of m.pages) {
    ws.addRow({
      title: p.title ?? new URL(p.url).pathname,
      url: p.url,
      device: p.device,
      status: PAGE_STATUS_TEXT[p.status] ?? p.status,
      count: p.changeCount,
      critical: p.bySeverity.critical ?? 0,
      high: p.bySeverity.high ?? 0,
      medium: p.bySeverity.medium ?? 0,
      low: p.bySeverity.low ?? 0,
      visual: p.visualDiffPercent ?? "",
      note: p.note ?? "",
    });
  }
  header(ws);
}

async function changesSheet(wb: ExcelJS.Workbook, name: string, changes: Change[], m: ReportModel, origin: string | undefined, embed: boolean) {
  const ws = wb.addWorksheet(name);
  ws.columns = [
    { header: "#", key: "n", width: 6 },
    { header: "Page name", key: "page", width: 26 },
    { header: "URL", key: "url", width: 40 },
    { header: "Device", key: "device", width: 9 },
    { header: "Category", key: "category", width: 12 },
    { header: "Change type", key: "type", width: 16 },
    { header: "Severity", key: "severity", width: 10 },
    { header: "Description", key: "description", width: 50 },
    { header: "Expected / baseline result", key: "expected", width: 45 },
    { header: "Actual / current result", key: "actual", width: 45 },
    { header: "Steps to reproduce / verify", key: "steps", width: 60 },
    { header: "Before evidence", key: "before", width: 36 },
    { header: "After evidence", key: "after", width: 36 },
    { header: "Diff / screenshots", key: "refs", width: 50 },
    { header: "Review status", key: "review", width: 15 },
    { header: "Page comparison status", key: "pageStatus", width: 24 },
    { header: "Reviewer note", key: "note", width: 30 },
    { header: "Element selector", key: "selector", width: 30 },
  ];
  header(ws);
  const storage = getStorage();
  const link = (key: string | null | undefined) => (key ? (origin ? `${origin}/api/files/${key}` : key) : "");
  let embedded = 0;
  for (let i = 0; i < changes.length; i++) {
    const c = changes[i];
    const ps = m.pages.find((p) => p.urlKey === c.urlKey && p.device === c.device);
    const refs = [
      c.evidence.diffImage && `Diff: ${link(c.evidence.diffImage)}`,
      c.evidence.baselineScreenshot && `Baseline screenshot: ${link(c.evidence.baselineScreenshot)}`,
      c.evidence.currentScreenshot && `Current screenshot: ${link(c.evidence.currentScreenshot)}`,
    ].filter(Boolean).join("\n");
    const row = ws.addRow({
      n: i + 1,
      page: pageName(c),
      url: c.url,
      device: c.device,
      category: c.category,
      type: c.changeType.replace("_", " "),
      severity: c.severity,
      description: c.description + (c.evidence.details?.length ? `\n${c.evidence.details.slice(0, 15).join("\n")}` : ""),
      expected: c.expected ?? "",
      actual: c.actual ?? "",
      steps: stepsToVerify(c),
      before: c.evidence.baselineCrop ? link(c.evidence.baselineCrop) : "",
      after: c.evidence.currentCrop ? link(c.evidence.currentCrop) : "",
      refs,
      review: REVIEW_TEXT[c.reviewStatus] + (c.autoIgnored ? " (ignore rule)" : ""),
      pageStatus: ps ? PAGE_STATUS_TEXT[ps.status] : "",
      note: c.reviewNote ?? "",
      selector: c.selector ?? "",
    });
    row.alignment = { vertical: "top", wrapText: true };
    row.getCell("severity").fill = { type: "pattern", pattern: "solid", fgColor: { argb: SEVERITY_FILL[c.severity] } };
    row.getCell("url").value = { text: c.url, hyperlink: c.url };

    // Embed evidence crops directly in the sheet (bounded to keep the file size reasonable).
    if (embed && embedded < MAX_EMBEDDED_IMAGES && (c.evidence.baselineCrop || c.evidence.currentCrop)) {
      let placed = false;
      for (const [key, col] of [[c.evidence.baselineCrop, 11], [c.evidence.currentCrop, 12]] as const) {
        if (!key || !(await storage.exists(key))) continue;
        const buf = await storage.read(key);
        const id = wb.addImage({ buffer: buf as unknown as ExcelJS.Buffer, extension: "jpeg" });
        ws.addImage(id, { tl: { col, row: row.number - 1 + 0.1 }, ext: { width: 240, height: 120 }, editAs: "oneCell" });
        embedded++;
        placed = true;
      }
      if (placed) row.height = 100;
    }
  }
}
