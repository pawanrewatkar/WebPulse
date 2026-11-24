import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getConfig } from "./config";

/**
 * File storage abstraction. Keys are forward-slash relative paths such as
 * "runs/12/home-ab12cd34ef/desktop/screenshot.png". The local implementation stores
 * them under DATA_DIR/storage; a Supabase Storage implementation can expose the same API later.
 */
export interface Storage {
  write(key: string, data: Buffer | string): Promise<void>;
  read(key: string): Promise<Buffer>;
  readText(key: string): Promise<string>;
  exists(key: string): Promise<boolean>;
  /** Absolute filesystem path (local storage only; used for streaming downloads and image libs). */
  resolve(key: string): string;
}

const SAFE_KEY = /^[a-zA-Z0-9][a-zA-Z0-9._\-/]*$/;

export function assertSafeKey(key: string): void {
  if (!SAFE_KEY.test(key) || key.includes("..") || key.includes("//")) {
    throw new Error(`Invalid storage key: ${key}`);
  }
}

class LocalStorage implements Storage {
  constructor(private root: string) {}

  resolve(key: string): string {
    assertSafeKey(key);
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error("Path escapes storage root");
    return full;
  }
  async write(key: string, data: Buffer | string) {
    const full = this.resolve(key);
    await fs.promises.mkdir(path.dirname(full), { recursive: true });
    const tmp = full + "." + crypto.randomBytes(4).toString("hex") + ".tmp";
    await fs.promises.writeFile(tmp, data);
    await fs.promises.rename(tmp, full);
  }
  read(key: string) {
    return fs.promises.readFile(this.resolve(key));
  }
  readText(key: string) {
    return fs.promises.readFile(this.resolve(key), "utf8");
  }
  async exists(key: string) {
    try {
      await fs.promises.access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }
}

let instance: Storage | null = null;
export function getStorage(): Storage {
  if (!instance) instance = new LocalStorage(getConfig().storageDir);
  return instance;
}
export function resetStorageForTests() {
  instance = null;
}

/** Readable, collision-safe folder name for a page URL. */
export function pageSlug(urlKey: string): string {
  const u = new URL(urlKey);
  const readable =
    (u.pathname === "/" ? "home" : u.pathname)
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "page";
  const hash = crypto.createHash("sha1").update(urlKey).digest("hex").slice(0, 10);
  return `${readable}-${hash}`;
}

export const storageKeys = {
  page: (runId: number, urlKey: string, device: string) => `runs/${runId}/${pageSlug(urlKey)}/${device}`,
  comparison: (comparisonId: number) => `comparisons/${comparisonId}`,
  report: (comparisonId: number, ext: string) => `reports/comparison-${comparisonId}.${ext}`,
};
