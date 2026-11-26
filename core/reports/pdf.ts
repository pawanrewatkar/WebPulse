import fs from "node:fs";
import PDFDocument from "pdfkit";
import { getStorage } from "../storage";
import { loadReportModel, PAGE_STATUS_TEXT, pageName, REVIEW_TEXT, stepsToVerify, type ReportModel } from "./model";
import type { Box, Change } from "../types";
import { annotateCrop, annotateFullPage, type AnnotateMark } from "./annotate";
import { friendlyTitle, highlightColor, SEVERITY_MEANING, whatToDo } from "./plain";

const COLORS: Record<string, string> = { critical: "#b91c1c", high: "#c2410c", medium: "#a16207", low: "#4b5563" };
const MAX_IMAGES = 160;

/** Unicode-capable system font if available; otherwise fall back to Helvetica with text sanitised to WinAnsi. */
function findFont(): string | null {
  const candidates = [
    process.env.PDF_FONT_PATH,
    "C:\\Windows\\Fonts\\arial.ttf",
    "C:\\Windows\\Fonts\\segoeui.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
  ].filter(Boolean) as string[];
  return candidates.find((p) => {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  }) ?? null;
}

export async function buildPdfReport(comparisonId: number): Promise<Buffer> {
  const m = await loadReportModel(comparisonId);
  const doc = new PDFDocument({ size: "A4", margin: 40, bufferPages: true, info: { Title: `Website change report – ${m.website.name}`, Author: "Website Change Monitor" } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const fontPath = findFont();
  if (fontPath) {
    doc.registerFont("body", fontPath);
    doc.font("body");
  } else doc.font("Helvetica");
  const bold = () => (fontPath ? doc.font("body") : doc.font("Helvetica-Bold"));
  const normal = () => (fontPath ? doc.font("body") : doc.font("Helvetica"));
  // Arrows etc. are not in every font; keep output readable everywhere.
  const t = (s: string | null | undefined) => {
    let x = (s ?? "").replace(/→/g, "->").replace(/←/g, "<-").replace(/≤/g, "<=").replace(/≥/g, ">=");
    if (!fontPath) x = x.replace(/[^\x20-\x7e\n\u00a0-\u00ff–—…•’‘“”€]/g, "?");
    return x;
  };
  const W = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const ensure = (h: number) => {
    if (doc.y + h > doc.page.height - doc.page.margins.bottom) doc.addPage();
  };

  // ---------------- Cover / overall summary
  const s = m.comparison.summary!;
  bold();
  doc.fontSize(20).text("Website change report", { align: "left" });
  normal();
  doc.moveDown(0.3).fontSize(11).fillColor("#374151");
  const kv: [string, string][] = [
    ["Website", `${m.website.name} (${m.website.baseUrl})`],
    ["Baseline version", `v${m.baseline.version}${m.baseline.label ? ` – ${m.baseline.label}` : ""}, captured ${fmt(m.baseline.finishedAt ?? m.baseline.createdAt)}`],
    ["Comparison date", fmt(m.current.finishedAt ?? m.current.createdAt)],
    ["Current crawl", `${m.current.status}${m.current.error ? ` – ${m.current.error}` : ""}`],
    ["Devices", m.current.devices.join(", ")],
    ["Report generated", fmt(m.generatedAt)],
  ];
  for (const [k, v] of kv) {
    bold();
    doc.fillColor("#111827").text(`${k}: `, { continued: true });
    normal();
    doc.fillColor("#374151").text(t(v));
  }
  doc.moveDown();
  bold();
  doc.fontSize(13).fillColor("#111827").text("Overall change summary");
  normal();
  doc.moveDown(0.3).fontSize(10);
  table(doc, [
    ["Total changes", String(s.totalChanges), "Critical", String(s.bySeverity.critical ?? 0)],
    ["Ignored changes", String(m.ignored.length), "High", String(s.bySeverity.high ?? 0)],
    ["Page views changed", `${s.pagesChanged} / ${s.pages.length}`, "Medium", String(s.bySeverity.medium ?? 0)],
    ["New pages", String(s.pagesNew), "Low", String(s.bySeverity.low ?? 0)],
    ["Removed (404/410)", String(s.pagesRemoved), "Crawl failures", String(s.pagesFailed)],
  ], [W * 0.3, W * 0.2, W * 0.3, W * 0.2]);
  doc.moveDown(0.5);
  doc.fontSize(10).fillColor("#374151").text(
    t(`By category: ${Object.entries(s.byCategory).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}.  By type: ${Object.entries(s.byType).map(([k, v]) => `${k.replace("_", " ")} ${v}`).join(", ") || "none"}.`),
  );
  if (s.pagesFailed) {
    doc.moveDown(0.5).fillColor("#92400e").text(`${s.pagesFailed} page view(s) could not be loaded during the current crawl. They are reported as "crawl failed - not verified" and NOT as removed pages.`);
  }

  const existing = s.existingBrokenLinks ?? [];
  if (existing.length) {
    doc.moveDown(0.5).fillColor("#075985").text(t(`Existing issues (already present in the baseline, not counted as changes): ${existing.length} broken link(s):`));
    for (const l of existing.slice(0, 40)) doc.fontSize(9).text(t(`• ${l.url} -> ${l.status ? `HTTP ${l.status}` : l.error ?? "request failed"}`));
    doc.fontSize(10);
  }

  // ---------------- Page-wise summary
  doc.moveDown();
  bold();
  doc.fontSize(13).fillColor("#111827").text("Page-wise summary");
  normal();
  doc.moveDown(0.3).fontSize(9);
  table(doc, [["Page", "Device", "Status", "Changes", "Crit/High"], ...m.pages.map((p) => [t(`${p.title ?? ""}\n${p.url}`), p.device, PAGE_STATUS_TEXT[p.status] ?? p.status, String(p.changeCount), `${p.bySeverity.critical ?? 0}/${p.bySeverity.high ?? 0}`])], [W * 0.5, W * 0.1, W * 0.2, W * 0.1, W * 0.1], true);

  // ---------------- Changes per page
  const storage = getStorage();
  let images = 0;
  const groups = new Map<string, Change[]>();
  for (const c of m.changes) {
    const k = `${c.urlKey}|${c.device}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(c);
  }
  let n = 0;
  const colW = (W - 10) / 2;
  /** Draws two images side by side (either may be missing → placeholder text). Returns nothing; moves doc.y below. */
  const drawPair = (bufs: Array<Buffer | null>, labels: [string, string], maxH: number, missing: [string, string]) => {
    ensure(Math.min(maxH, 200) + 24);
    const y = doc.y + 2;
    doc.fontSize(8).fillColor("#6b7280");
    doc.text(labels[0], doc.page.margins.left, y, { width: colW });
    doc.text(labels[1], doc.page.margins.left + colW + 10, y, { width: colW });
    const iy = y + 11;
    let h = 40;
    bufs.forEach((buf, i) => {
      const x = doc.page.margins.left + i * (colW + 10);
      if (!buf) {
        doc.rect(x, iy, colW, 40).fillAndStroke("#fffbeb", "#fcd34d");
        doc.fillColor("#92400e").fontSize(8).text(t(missing[i]), x + 6, iy + 12, { width: colW - 12 });
        return;
      }
      const opened = (doc as any).openImage(buf);
      const scale = Math.min(colW / opened.width, maxH / opened.height, 1);
      doc.image(opened, x, iy, { width: opened.width * scale, height: opened.height * scale });
      doc.rect(x, iy, opened.width * scale, opened.height * scale).lineWidth(0.5).strokeColor("#d1d5db").stroke();
      h = Math.max(h, opened.height * scale);
      images++;
    });
    doc.x = doc.page.margins.left;
    doc.y = iy + h + 8;
  };
  const read = async (k: string | null | undefined) => (k && (await storage.exists(k)) ? storage.read(k) : null);

  for (const [, list] of groups) {
    doc.addPage();
    const first = list[0];
    const ps = m.pages.find((p) => p.urlKey === first.urlKey && p.device === first.device);
    const numbers = new Map(list.map((c, i) => [c.id, n + i + 1]));
    bold();
    doc.fontSize(14).fillColor("#111827").text(t(pageName(first)));
    normal();
    doc.fontSize(9).fillColor("#2563eb").text(first.url, { link: first.url, underline: true });
    doc.fillColor("#374151").text(t(`Device: ${first.device} · Status: ${ps ? PAGE_STATUS_TEXT[ps.status] : "-"} · ${list.length} change(s)`));
    doc.moveDown(0.4);

    // Whole page before | now with every change outlined and numbered.
    const [beforeShot, nowShot] = await Promise.all([read(first.evidence.baselineScreenshot), read(first.evidence.currentScreenshot)]);
    if ((beforeShot || nowShot) && images < MAX_IMAGES) {
      const bMarks: AnnotateMark[] = [];
      const aMarks: AnnotateMark[] = [];
      for (const c of list) {
        const label = `#${numbers.get(c.id)}`;
        const color = highlightColor(c);
        if (c.category === "visual") for (const r of c.evidence.regions ?? []) {
          bMarks.push({ box: [r.x, r.y, r.width, r.height], color, label });
          aMarks.push({ box: [r.x, r.y, r.width, r.height], color, label });
        } else {
          if (c.evidence.beforeBox) bMarks.push({ box: c.evidence.beforeBox, color, label });
          if (c.evidence.afterBox) aMarks.push({ box: c.evidence.afterBox, color, label });
        }
      }
      doc.fontSize(8.5).fillColor("#374151").text("Whole page – red boxes: changed or missing, green boxes: new. Numbers match the changes listed below.");
      drawPair(
        [beforeShot ? await annotateFullPage(beforeShot, bMarks) : null, nowShot ? await annotateFullPage(nowShot, aMarks) : null],
        ["Before (saved baseline)", "Now (latest check)"],
        520,
        ["No baseline screenshot", "No current screenshot – the page could not be loaded during the latest check"],
      );
    }

    for (const c of list) {
      n++;
      ensure(110);
      doc.moveDown(0.3);
      bold();
      doc.fontSize(11).fillColor(COLORS[c.severity]).text(t(`#${n}  ${c.severity.toUpperCase()}  `), { continued: true });
      doc.fillColor("#111827").text(t(friendlyTitle(c)));
      normal();
      doc.fontSize(9).fillColor("#4b5563").text(t(c.description));
      doc.fontSize(7.5).fillColor("#6b7280").text(t(SEVERITY_MEANING[c.severity]));
      doc.fontSize(8.5).fillColor("#374151");
      const line = (label: string, value: string | null | undefined, color = "#374151") => {
        if (!value) return;
        ensure(24);
        bold();
        doc.fillColor("#111827").text(`${label}: `, { continued: true });
        normal();
        doc.fillColor(color).text(t(clip(value, 700)));
      };

      // Close-up before / now with the changed area outlined.
      if (images < MAX_IMAGES) {
        const ev = c.evidence;
        const color = highlightColor(c);
        let pair: Array<Buffer | null> | null = null;
        if (c.category === "visual" && ev.regions?.length && (beforeShot || nowShot)) {
          const boxes = ev.regions.map((r) => [r.x, r.y, r.width, r.height] as Box);
          const marks = boxes.map((box) => ({ box, color }));
          pair = [beforeShot ? await annotateCrop(beforeShot, boxes[0], marks) : null, nowShot ? await annotateCrop(nowShot, boxes[0], marks) : null];
        } else if ((ev.beforeBox || ev.afterBox) && (beforeShot || nowShot)) {
          const bFocus = ev.beforeBox ?? ev.afterBox ?? null;
          const aFocus = ev.afterBox ?? ev.beforeBox ?? null;
          pair = [
            // New items have no position on the old page → "Not on the page before" placeholder instead of unrelated content.
            beforeShot && ev.beforeBox ? await annotateCrop(beforeShot, bFocus, ev.beforeBox ? [{ box: ev.beforeBox, color, label: c.changeType === "removed" ? "missing now" : undefined }] : []) : null,
            nowShot ? await annotateCrop(nowShot, aFocus, ev.afterBox ? [{ box: ev.afterBox, color, label: c.changeType === "added" ? "new" : undefined }] : []) : null,
          ];
        } else if (ev.baselineCrop || ev.currentCrop) {
          pair = await Promise.all([read(ev.baselineCrop), read(ev.currentCrop)]);
        }
        if (pair && (pair[0] || pair[1])) drawPair(pair, ["Before (saved baseline)", "Now (latest check)"], 190, ["Not on the page before", "Not on the page now"]);
      }

      line("Was (baseline)", c.expected);
      line("Now (current)", c.actual);
      line("What to do", whatToDo(c), "#075985");
      line("Steps to verify", "\n" + stepsToVerify(c));
      line("Review status", REVIEW_TEXT[c.reviewStatus] + (c.reviewNote ? ` – ${c.reviewNote}` : ""));
      const refs = [c.evidence.baselineScreenshot && `baseline: ${c.evidence.baselineScreenshot}`, c.evidence.currentScreenshot && `current: ${c.evidence.currentScreenshot}`, c.evidence.diffImage && `diff: ${c.evidence.diffImage}`].filter(Boolean).join("  |  ");
      if (refs) {
        doc.fontSize(7).fillColor("#9ca3af").text(t(`Technical reference – evidence files: ${refs}`));
      }
      doc.moveDown(0.5);
      doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.margins.left + W, doc.y).lineWidth(0.3).strokeColor("#e5e7eb").stroke();
      doc.moveDown(0.3);
    }
  }
  if (!m.changes.length) {
    doc.addPage();
    doc.fontSize(12).fillColor("#065f46").text("No (non-ignored) changes were detected in this comparison.");
  }

  // Footer with page numbers
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.fontSize(7.5).fillColor("#9ca3af");
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.text(t(`${m.website.name} · compared ${fmt(m.current.finishedAt ?? m.current.createdAt)} vs baseline v${m.baseline.version} · page ${i + 1} of ${range.count}`), doc.page.margins.left, doc.page.height - 25, { width: W, align: "center" });
    doc.page.margins.bottom = bottom;
  }
  doc.end();
  return done;
}

function fmt(iso: string) {
  return new Date(iso).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}
function clip(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/** Simple wrapped-text table. */
function table(doc: PDFKit.PDFDocument, rows: string[][], widths: number[], headerRow = false) {
  const x0 = doc.page.margins.left;
  rows.forEach((row, ri) => {
    const heights = row.map((cell, i) => doc.heightOfString(cell, { width: widths[i] - 8 }));
    const h = Math.max(...heights) + 6;
    if (doc.y + h > doc.page.height - doc.page.margins.bottom) doc.addPage();
    const y = doc.y;
    if (headerRow && ri === 0) doc.rect(x0, y, widths.reduce((a, b) => a + b, 0), h).fill("#f3f4f6");
    let x = x0;
    row.forEach((cell, i) => {
      doc.fillColor("#111827").text(cell, x + 4, y + 3, { width: widths[i] - 8 });
      x += widths[i];
    });
    doc.moveTo(x0, y + h).lineTo(x, y + h).lineWidth(0.3).strokeColor("#e5e7eb").stroke();
    doc.y = y + h;
    doc.x = x0;
  });
}
