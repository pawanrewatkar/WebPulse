import { getRepo } from "@core/db";
import { getStorage, storageKeys } from "@core/storage";
import { ServiceError } from "@core/services";
import { buildExcelReport } from "@core/reports/excel";
import { buildPdfReport } from "@core/reports/pdf";
import { handler, parseId, type Ctx } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Generates the report on demand (reflects the latest review status) and stores a copy under reports/. */
export const GET = handler(async (req: Request, ctx: Ctx<{ id: string }>) => {
  const id = parseId((await ctx.params).id);
  const format = new URL(req.url).searchParams.get("format") === "pdf" ? "pdf" : "xlsx";
  const cmp = await getRepo().getComparison(id);
  if (!cmp) throw new ServiceError("Comparison not found", 404);
  if (cmp.status !== "completed") throw new ServiceError("Comparison has not completed yet", 409);
  const website = await getRepo().getWebsite(cmp.websiteId);
  const origin = new URL(req.url).origin;
  const buf = format === "pdf" ? await buildPdfReport(id) : await buildExcelReport(id, origin);
  await getStorage().write(storageKeys.report(id, format), buf);
  const safeName = (website?.name ?? "website").replace(/[^a-zA-Z0-9-_]+/g, "-").slice(0, 40);
  const date = new Date(cmp.createdAt).toISOString().slice(0, 16).replace("T", "_").replace(":", "-");
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${safeName}-comparison-${date}.${format}"`,
      "Cache-Control": "no-store",
    },
  });
});
