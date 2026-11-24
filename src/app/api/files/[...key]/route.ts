import fs from "node:fs";
import { getStorage, assertSafeKey } from "@core/storage";
import { handler, type Ctx } from "@/lib/api";
import { ServiceError } from "@core/services";

export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  json: "application/json; charset=utf-8",
  html: "text/plain; charset=utf-8", // never render captured HTML as a live page
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
};

/** Serves stored captures (screenshots, DOM snapshots, data, reports) with path-traversal protection. */
export const GET = handler(async (req: Request, ctx: Ctx<{ key: string[] }>) => {
  const key = (await ctx.params).key.map(decodeURIComponent).join("/");
  try {
    assertSafeKey(key);
  } catch {
    throw new ServiceError("Invalid path", 400);
  }
  const storage = getStorage();
  if (!(await storage.exists(key))) throw new ServiceError("File not found", 404);
  const full = storage.resolve(key);
  const ext = key.split(".").pop()!.toLowerCase();
  const data = await fs.promises.readFile(full);
  const headers: Record<string, string> = {
    "Content-Type": TYPES[ext] ?? "application/octet-stream",
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox",
  };
  if (new URL(req.url).searchParams.get("download") === "1") {
    headers["Content-Disposition"] = `attachment; filename="${key.split("/").pop()}"`;
  }
  return new Response(new Uint8Array(data), { headers });
});
