import { getConfig } from "./config";

type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const SENSITIVE_KEY = /pass(word)?|secret|token|credential|cookie|authorization|api[-_]?key/i;

/** Recursively replaces values of sensitive-looking keys. Never log raw credentials. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY.test(k) ? "[REDACTED]" : redact(v, depth + 1);
  }
  return out;
}

export interface Logger {
  debug(msg: string, meta?: unknown): void;
  info(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
  error(msg: string, meta?: unknown): void;
}

export function createLogger(scope: string, sink?: (level: Level, msg: string) => void): Logger {
  const min = ORDER[getConfig().logLevel];
  const log = (level: Level, msg: string, meta?: unknown) => {
    const metaStr = meta === undefined ? "" : " " + safeJson(redact(meta));
    if (ORDER[level] >= min) {
      const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${msg}${metaStr}`;
      if (level === "error") console.error(line);
      else if (level === "warn") console.warn(line);
      else console.log(line);
    }
    if (sink && ORDER[level] >= ORDER.info) sink(level, msg + metaStr);
  };
  return {
    debug: (m, meta) => log("debug", m, meta),
    info: (m, meta) => log("info", m, meta),
    warn: (m, meta) => log("warn", m, meta),
    error: (m, meta) => log("error", m, meta),
  };
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v instanceof Error ? { message: v.message } : v);
  } catch {
    return String(v);
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message.split("\n")[0].slice(0, 500);
  return String(err).slice(0, 500);
}
