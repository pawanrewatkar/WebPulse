import { NextResponse } from "next/server";
import { getRepo } from "@core/db";
import { getStorage } from "@core/storage";
import { ServiceError } from "@core/services";
import { normalizeUrl } from "@core/security/url";
import { handler, parseId, type Ctx } from "@/lib/api";
import type { PageData } from "@core/types";

export const dynamic = "force-dynamic";

/** A stored page capture with its extracted data and link-check results (from the same run). */
export const GET = handler(async (_req: Request, ctx: Ctx<{ id: string }>) => {
  const id = parseId((await ctx.params).id);
  const repo = getRepo();
  const page = await repo.getPage(id);
  if (!page) throw new ServiceError("Page not found", 404);
  let data: PageData | null = null;
  if (page.dataPath) {
    try {
      data = JSON.parse(await getStorage().readText(page.dataPath));
    } catch {
      data = null;
    }
  }
  const linkChecks: Record<string, { status: number | null; ok: boolean; error: string | null }> = {};
  if (data) {
    const checks = new Map((await repo.listLinkChecks(page.runId)).map((c) => [c.url, c]));
    for (const l of [...data.links.map((x) => x.href), ...data.images.map((x) => x.src)]) {
      try {
        const c = checks.get(normalizeUrl(l));
        if (c) linkChecks[l] = { status: c.status, ok: c.ok, error: c.error };
      } catch {
        /* non-http */
      }
    }
  }
  const run = await repo.getRun(page.runId);
  return NextResponse.json({ page, run, data, linkChecks });
});
