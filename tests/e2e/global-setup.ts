import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

/** Starts a real background worker against the E2E data directory; returns the teardown. */
export default async function globalSetup() {
  const worker: ChildProcess = spawn(process.execPath, [path.resolve("node_modules/tsx/dist/cli.mjs"), "worker/index.ts"], {
    env: { ...process.env, DATA_DIR: "./data-test" },
    stdio: ["ignore", "inherit", "inherit"],
  });
  await new Promise((r) => setTimeout(r, 1500));
  if (worker.exitCode !== null) throw new Error("Worker failed to start");
  return async () => {
    worker.kill();
  };
}
