import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { useTempDataDir } from "../helpers";
import { assertSafeUrl, isInternalUrl, isPrivateAddress, matchesAnyPattern, normalizeUrl, parseHttpUrl } from "../../core/security/url";
import { decryptString, encryptString } from "../../core/security/crypto";
import { redact } from "../../core/logger";

let env: ReturnType<typeof useTempDataDir>;
beforeAll(() => {
  env = useTempDataDir();
});
afterAll(() => env.cleanup());

describe("normalizeUrl", () => {
  it("canonicalises host, fragment, default port, trailing slash, tracking params and param order", () => {
    expect(normalizeUrl("HTTPS://Example.COM:443/About/?b=2&utm_source=x&a=1#top")).toBe("https://example.com/About?a=1&b=2");
    expect(normalizeUrl("https://example.com")).toBe("https://example.com/");
    expect(normalizeUrl("/x//y/", "https://example.com/a/")).toBe("https://example.com/x/y");
  });
});

describe("parseHttpUrl", () => {
  it("rejects non-http schemes and embedded credentials", () => {
    expect(() => parseHttpUrl("file:///etc/passwd")).toThrow();
    expect(() => parseHttpUrl("javascript:alert(1)")).toThrow();
    expect(() => parseHttpUrl("https://user:pw@example.com")).toThrow();
    expect(parseHttpUrl("https://example.com/x").hostname).toBe("example.com");
  });
});

describe("isInternalUrl", () => {
  it("treats www and same host as internal, others external unless allowed", () => {
    expect(isInternalUrl("https://www.example.com/a", "https://example.com/")).toBe(true);
    expect(isInternalUrl("https://evil.com/a", "https://example.com/")).toBe(false);
    expect(isInternalUrl("https://shop.example.org/a", "https://example.com/", ["example.org"])).toBe(true);
    expect(isInternalUrl("mailto:a@example.com", "https://example.com/")).toBe(false);
  });
});

describe("SSRF protection", () => {
  it("classifies private addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.5.4", "192.168.1.1", "169.254.169.254", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "172.32.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });
  it("blocks metadata/private IPs but allows allow-listed hosts", async () => {
    await expect(assertSafeUrl("http://169.254.169.254/latest/meta-data")).rejects.toThrow(/private/);
    await expect(assertSafeUrl("http://10.0.0.5/")).rejects.toThrow(/private/);
    await expect(assertSafeUrl("http://127.0.0.1:4400/")).resolves.toBeTruthy(); // allow-listed in tests
    await expect(assertSafeUrl("ftp://example.com/")).rejects.toThrow(/http/);
  });
});

describe("patterns", () => {
  it("supports wildcards and regex", () => {
    expect(matchesAnyPattern("https://x.com/logout?a", ["*/logout*"])).toBe(true);
    expect(matchesAnyPattern("https://x.com/blog/2024", ["/\\/blog\\/\\d+/"])).toBe(true);
    expect(matchesAnyPattern("https://x.com/about", ["*/logout*"])).toBe(false);
  });
});

describe("credential encryption", () => {
  it("round-trips and does not leak plaintext", () => {
    const enc = encryptString("s3cret-P@ss");
    expect(enc).not.toContain("s3cret");
    expect(decryptString(enc)).toBe("s3cret-P@ss");
    expect(encryptString("same")).not.toBe(encryptString("same")); // random IV
  });
  it("detects tampering", () => {
    const enc = encryptString("value");
    const tampered = enc.slice(0, -4) + (enc.endsWith("AAAA") ? "BBBB" : "AAAA");
    expect(() => decryptString(tampered)).toThrow();
  });
});

describe("log redaction", () => {
  it("redacts sensitive keys recursively", () => {
    expect(redact({ user: "a", password: "x", nested: { apiKey: "k", ok: 1 } })).toEqual({
      user: "a",
      password: "[REDACTED]",
      nested: { apiKey: "[REDACTED]", ok: 1 },
    });
  });
});
