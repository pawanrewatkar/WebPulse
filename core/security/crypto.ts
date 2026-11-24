import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getConfig } from "../config";

let keyCache: Buffer | null = null;

/** Derives the 256-bit encryption key from APP_SECRET, or a generated key file stored in DATA_DIR. */
function getKey(): Buffer {
  if (keyCache) return keyCache;
  const secret = process.env.APP_SECRET;
  if (secret && secret.length >= 16) {
    keyCache = crypto.createHash("sha256").update(secret).digest();
    return keyCache;
  }
  const keyFile = path.join(getConfig().dataDir, "secret.key");
  if (!fs.existsSync(keyFile)) {
    fs.mkdirSync(path.dirname(keyFile), { recursive: true });
    fs.writeFileSync(keyFile, crypto.randomBytes(32).toString("base64"), { mode: 0o600 });
  }
  keyCache = Buffer.from(fs.readFileSync(keyFile, "utf8").trim(), "base64");
  if (keyCache.length !== 32) throw new Error("Invalid secret.key file (expected 32 bytes base64)");
  return keyCache;
}

/** AES-256-GCM. Output: base64(iv | tag | ciphertext) prefixed with a version marker. */
export function encryptString(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return "v1:" + Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptString(payload: string): string {
  if (!payload.startsWith("v1:")) throw new Error("Unsupported credential format");
  const buf = Buffer.from(payload.slice(3), "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

export function resetKeyCacheForTests() {
  keyCache = null;
}
