import { NextResponse } from "next/server";
import { ServiceError } from "@core/services";
import { createLogger, errorMessage } from "@core/logger";

const log = createLogger("api");

/** Wraps a route handler: converts ServiceError to proper HTTP codes and hides internal errors. */
export function handler<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof ServiceError) return NextResponse.json({ error: e.message }, { status: e.status });
      log.error("Unhandled API error", { message: errorMessage(e) });
      return NextResponse.json({ error: "Internal error: " + errorMessage(e) }, { status: 500 });
    }
  };
}

export function parseId(v: string | undefined): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new ServiceError("Invalid id", 400);
  return n;
}

export async function readJson(req: Request): Promise<any> {
  try {
    return await req.json();
  } catch {
    throw new ServiceError("Invalid JSON body", 400);
  }
}

export type Ctx<P> = { params: Promise<P> };
