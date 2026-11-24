import { defineConfig } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const env = {
  DATA_DIR: "./data-test",
  APP_SECRET: "e2e-secret-e2e-secret-e2e-secret",
  ALLOWED_PRIVATE_HOSTS: "localhost,127.0.0.1",
  WORKER_POLL_MS: "500",
  LOG_LEVEL: "warn",
};
Object.assign(process.env, env);

// Fresh state for every E2E run, before any server opens the database (config is also loaded by
// test worker processes, which inherit the guard variable and therefore skip this).
if (!process.env.WCM_E2E_CLEANED) {
  process.env.WCM_E2E_CLEANED = "1";
  fs.rmSync(path.resolve("data-test"), { recursive: true, force: true });
  fs.mkdirSync(path.resolve("data-test"), { recursive: true });
}

/**
 * E2E: runs the production build (`npm run build` first), a real worker process (started in global setup)
 * and the local fixture website. Uses a separate data directory (data-test/).
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 300_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: { baseURL: "http://localhost:3100", trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: [
    { command: "npx tsx tests/fixtures/site-server.ts --port 4400", url: "http://localhost:4400/robots.txt", reuseExistingServer: false, env },
    { command: "npx next start -p 3100", url: "http://localhost:3100/api/health", reuseExistingServer: false, env, timeout: 120_000 },
  ],
});
