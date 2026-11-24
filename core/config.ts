import fs from "node:fs";
import path from "node:path";

/**
 * Central runtime configuration. Read from environment variables; the worker and CLI
 * load .env.local/.env themselves (Next.js does this automatically for the web app).
 */
let envLoaded = false;
function loadEnvFiles() {
  if (envLoaded) return;
  envLoaded = true;
  for (const f of [".env.local", ".env"]) {
    const p = path.resolve(/* turbopackIgnore: true */ process.cwd(), f);
    if (fs.existsSync(p)) {
      try {
        // Does not override variables that are already set.
        process.loadEnvFile(p);
      } catch {
        /* ignore malformed env file */
      }
    }
  }
}

export interface AppConfig {
  dataDir: string;
  dbPath: string;
  storageDir: string;
  allowedPrivateHosts: string[];
  allowPrivateNetworks: boolean;
  workerPollMs: number;
  logLevel: "debug" | "info" | "warn" | "error";
}

let cached: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (cached) return cached;
  loadEnvFiles();
  const dataDir = path.resolve(/* turbopackIgnore: true */ process.cwd(), process.env.DATA_DIR || "./data");
  const level = (process.env.LOG_LEVEL || "info").toLowerCase();
  cached = {
    dataDir,
    dbPath: path.join(dataDir, "app.db"),
    storageDir: path.join(dataDir, "storage"),
    allowedPrivateHosts: (process.env.ALLOWED_PRIVATE_HOSTS || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    allowPrivateNetworks: process.env.ALLOW_PRIVATE_NETWORKS === "true",
    workerPollMs: Math.max(250, Number(process.env.WORKER_POLL_MS) || 2000),
    logLevel: (["debug", "info", "warn", "error"].includes(level) ? level : "info") as AppConfig["logLevel"],
  };
  fs.mkdirSync(cached.storageDir, { recursive: true });
  return cached;
}

/** For tests: drop the cached config so env changes take effect. */
export function resetConfigForTests() {
  cached = null;
}
