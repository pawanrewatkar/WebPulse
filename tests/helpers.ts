import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resetConfigForTests } from "../core/config";
import { closeRepo } from "../core/db";
import { resetKeyCacheForTests } from "../core/security/crypto";
import { resetStorageForTests } from "../core/storage";
import { clearSsrfCacheForTests } from "../core/security/url";

/** Points DATA_DIR at a fresh temp directory so tests never touch real data. */
export function useTempDataDir(prefix = "wcm-test-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  process.env.DATA_DIR = dir;
  process.env.APP_SECRET = "test-secret-test-secret-test-secret";
  process.env.ALLOWED_PRIVATE_HOSTS = "localhost,127.0.0.1";
  process.env.ALLOW_PRIVATE_NETWORKS = "false";
  process.env.LOG_LEVEL = "warn";
  closeRepo();
  resetConfigForTests();
  resetKeyCacheForTests();
  resetStorageForTests();
  clearSsrfCacheForTests();
  return {
    dir,
    cleanup() {
      closeRepo();
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* Windows may hold file locks briefly */
      }
    },
  };
}
