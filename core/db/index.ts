import { getConfig } from "../config";
import type { Repository } from "./repository";
import { SqliteRepository } from "./sqlite";

export type { Repository, Credentials, ChangeFilter } from "./repository";

// Keep a single connection per process (survives Next.js dev hot reloads via globalThis).
const g = globalThis as unknown as { __wcmRepo?: Repository };

export function getRepo(): Repository {
  if (!g.__wcmRepo) {
    // Future: if (process.env.DATABASE_URL) return new PostgresRepository(...)
    g.__wcmRepo = new SqliteRepository(getConfig().dbPath);
  }
  return g.__wcmRepo;
}

export function closeRepo() {
  g.__wcmRepo?.close();
  g.__wcmRepo = undefined;
}
