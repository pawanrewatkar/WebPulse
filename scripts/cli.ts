/**
 * Command-line interface: run crawls, comparisons and reports without the web app or worker.
 *
 *   npm run cli -- list
 *   npm run cli -- add "My site" https://example.com
 *   npm run cli -- baseline <websiteId> [--label "Release 2"]
 *   npm run cli -- compare <websiteId> [baselineRunId]
 *   npm run cli -- report <comparisonId> xlsx|pdf [outputFile]
 *   npm run cli -- jobs
 */
import fs from "node:fs";
import path from "node:path";
import { closeRepo, getRepo } from "../core/db";
import { createWebsite, ServiceError, startBaseline, startCompare } from "../core/services";
import { executeJob } from "../core/jobs/runner";
import { buildExcelReport } from "../core/reports/excel";
import { buildPdfReport } from "../core/reports/pdf";
import type { Job } from "../core/types";

const [cmd, ...args] = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

async function runInline(job: Job) {
  const repo = getRepo();
  const claimed = await repo.claimJob(job.id);
  if (!claimed) throw new Error(`Job #${job.id} was already picked up by a running worker – follow it in the web UI.`);
  console.log(`Running job #${job.id} (${job.type}) inline…`);
  const res = await executeJob(claimed);
  if (!res.ok) throw new Error(res.error ?? "Job did not complete");
  console.log(res.result?.message ?? "Done");
  return res.result!;
}

async function main() {
  const repo = getRepo();
  switch (cmd) {
    case "list": {
      for (const w of await repo.listWebsites()) {
        const baselines = await repo.listRuns(w.id, "baseline");
        console.log(`#${w.id}  ${w.name}  ${w.baseUrl}  baselines=${baselines.length} active=${baselines.find((b) => b.id === w.activeBaselineId)?.version ?? "-"}`);
      }
      break;
    }
    case "add": {
      const [name, url] = args;
      if (!name || !url) throw new Error('Usage: add "<name>" <url>');
      const w = await createWebsite({ name, baseUrl: url });
      console.log(`Created website #${w.id} (${w.baseUrl})`);
      break;
    }
    case "baseline": {
      const id = Number(args[0]);
      const job = await startBaseline(id, { label: flag("label"), confirmNewVersion: true });
      await runInline(job);
      break;
    }
    case "compare": {
      const id = Number(args[0]);
      const job = await startCompare(id, args[1] ? Number(args[1]) : undefined);
      const result = await runInline(job);
      const cmp = await repo.getComparison(result.comparisonId as number);
      const s = cmp?.summary;
      if (s) {
        console.log(`Changes: ${s.totalChanges} (critical ${s.bySeverity.critical ?? 0}, high ${s.bySeverity.high ?? 0}, medium ${s.bySeverity.medium ?? 0}, low ${s.bySeverity.low ?? 0})`);
        for (const p of s.pages.filter((p) => p.status !== "unchanged")) console.log(`  ${p.status.padEnd(13)} ${p.device.padEnd(7)} ${p.url}  (${p.changeCount})${p.note ? " – " + p.note : ""}`);
      }
      break;
    }
    case "report": {
      const id = Number(args[0]);
      const format = args[1] === "pdf" ? "pdf" : "xlsx";
      const out = path.resolve(args[2] ?? `comparison-${id}.${format}`);
      const buf = format === "pdf" ? await buildPdfReport(id) : await buildExcelReport(id);
      fs.writeFileSync(out, buf);
      console.log(`Wrote ${out} (${Math.round(buf.length / 1024)} KB)`);
      break;
    }
    case "jobs": {
      for (const j of await repo.listJobs({ limit: 30 })) console.log(`#${j.id} ${j.type.padEnd(9)} ${j.status.padEnd(9)} ${j.error ?? j.message ?? ""}`);
      break;
    }
    default:
      console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("*/")[0].replace("/**", "").replace(/^ \* ?/gm, ""));
  }
}

main()
  .catch((e) => {
    console.error(e instanceof ServiceError ? `Error: ${e.message}` : e);
    process.exitCode = 1;
  })
  .finally(() => closeRepo());
