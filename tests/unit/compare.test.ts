import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { diffSequences, normalizeText, similarity, buildTextFilters } from "../../core/compare/text";
import { detectChanges, type DetectContext } from "../../core/compare/detectors";
import { findRegions, visualDiff, cropImage } from "../../core/compare/visual";
import { parseSettings } from "../../core/settings";
import { parseSitemap, parseRobotsSitemaps } from "../../core/crawler/discovery";
import type { PageData } from "../../core/types";

function page(over: Partial<PageData> = {}): PageData {
  return {
    url: "https://x.com/",
    finalUrl: "https://x.com/",
    title: "Home",
    lang: "en",
    meta: { description: "desc", keywords: "", robots: "", canonical: "", viewport: "width=device-width", og: {}, twitter: {} },
    headings: [{ level: 1, text: "Welcome", selector: "h1" }],
    textBlocks: [
      { tag: "p", text: "First paragraph about widgets.", selector: "p:nth-of-type(1)" },
      { tag: "p", text: "Second paragraph.", selector: "p:nth-of-type(2)" },
    ],
    buttons: [{ text: "Buy now", tag: "a", href: "https://x.com/buy", selector: "a.btn" }],
    images: [{ src: "https://x.com/a.png?v=1", alt: "A", width: 10, height: 10, naturalWidth: 10, naturalHeight: 10, loaded: true, selector: "img" }],
    links: [{ href: "https://x.com/about", text: "About", rel: "", target: "", selector: "a" }],
    sections: [{ tag: "section", id: "hero", classes: "", role: "", heading: "Welcome", textLength: 10, textSample: "Welcome", top: 0, height: 100, selector: "#hero" }],
    forms: [],
    iframes: [],
    domStats: { elementCount: 10, maxDepth: 3, tagCounts: {} },
    outline: ["header", "section#hero", "  h1", "footer"],
    layout: { scrollWidth: 390, scrollHeight: 800, viewportWidth: 390, viewportHeight: 844, horizontalOverflow: false },
    ...over,
  };
}

const ctx = (over: Partial<DetectContext> = {}): DetectContext => ({
  textFilters: buildTextFilters(parseSettings({})),
  linkChecksBefore: new Map(),
  linkChecksAfter: new Map(),
  device: "desktop",
  ...over,
});

describe("text utilities", () => {
  it("filters timestamps/dates with built-in noise patterns", () => {
    const f = buildTextFilters(parseSettings({}));
    expect(normalizeText("Updated 2026-11-24 10:22:01 by bot", f)).toBe(normalizeText("Updated 2025-01-02 08:00:59 by bot", f));
    expect(normalizeText("Posted 3 hours ago", f)).toBe(normalizeText("Posted 5 hours ago", f));
    expect(normalizeText("Price $29", f)).not.toBe(normalizeText("Price $34", f));
  });
  it("supports custom ignore patterns", () => {
    const f = buildTextFilters(parseSettings({ builtInNoiseFilters: false, ignoreTextPatterns: ["Visitors: *", "/session [a-f0-9]+/i"] }));
    expect(normalizeText("Visitors: 1234", f)).toBe("");
    expect(normalizeText("id Session abc123 end", f)).toBe("id end");
  });
  it("groups diff hunks", () => {
    const h = diffSequences(["a", "b", "c", "d"], ["a", "x", "c", "d", "e"], (s) => s);
    expect(h).toEqual([{ removed: ["b"], added: ["x"] }, { removed: [], added: ["e"] }]);
  });
  it("scores similarity", () => {
    expect(similarity("we build reliable widgets", "we build reliable affordable widgets")).toBeGreaterThan(0.4);
    expect(similarity("completely different", "nothing alike here")).toBe(0);
    expect(similarity("Price: $29", "Price: $34")).toBeGreaterThan(0.3);
  });
});

describe("detectors", () => {
  it("reports nothing for identical pages", () => {
    expect(detectChanges(page(), page(), ctx())).toEqual([]);
  });

  it("ignores timestamp-only text changes (noise filter)", () => {
    const b = page({ textBlocks: [{ tag: "p", text: "Last updated: 2026-01-01 10:00:00", selector: "p" }] });
    const a = page({ textBlocks: [{ tag: "p", text: "Last updated: 2026-11-24 21:13:59", selector: "p" }] });
    expect(detectChanges(b, a, ctx())).toEqual([]);
  });

  it("classifies metadata, heading, content, CTA, image, link, section and responsive changes", () => {
    const b = page();
    const a = page({
      title: "Home – new",
      meta: { ...b.meta, robots: "noindex" },
      headings: [{ level: 1, text: "Welcome!", selector: "h1" }],
      textBlocks: [
        { tag: "p", text: "First paragraph about great widgets.", selector: "p:nth-of-type(1)" },
        { tag: "p", text: "Brand new paragraph.", selector: "p:nth-of-type(3)" },
      ],
      buttons: [{ text: "Buy now", tag: "a", href: "https://x.com/checkout", selector: "a.btn" }],
      images: [
        { src: "https://x.com/b.png", alt: "A", width: 10, height: 10, naturalWidth: 10, naturalHeight: 10, loaded: true, selector: "img" },
        { src: "https://x.com/missing.png", alt: "Promo", width: 0, height: 0, naturalWidth: 0, naturalHeight: 0, loaded: false, selector: "img:nth-of-type(2)" },
      ],
      links: [{ href: "https://x.com/about", text: "About us", rel: "", target: "", selector: "a" }, { href: "https://x.com/old", text: "Old", rel: "", target: "", selector: "a2" }],
      sections: [...b.sections, { tag: "section", id: "newsletter", classes: "", role: "", heading: "Newsletter", textLength: 5, textSample: "News", top: 100, height: 50, selector: "#newsletter" }],
      layout: { ...b.layout, scrollWidth: 700, horizontalOverflow: true },
    });
    const c = detectChanges(b, a, ctx({
      device: "mobile",
      linkChecksAfter: new Map([
        ["https://x.com/old", { runId: 2, url: "https://x.com/old", status: 404, ok: false, error: "HTTP 404" }],
        ["https://x.com/missing.png", { runId: 2, url: "https://x.com/missing.png", status: 404, ok: false, error: "HTTP 404" }],
      ]),
    }));
    const find = (cat: string, type: string, text?: string) => c.find((x) => x.category === cat && x.changeType === type && (!text || x.description.includes(text)));
    expect(find("metadata", "modified", "Page title")?.actual).toBe("Home – new");
    expect(find("metadata", "added", "NOINDEX")?.severity).toBe("critical");
    expect(find("heading", "modified")?.expected).toBe("H1: Welcome");
    expect(find("content", "modified")?.actual).toContain("great widgets");
    expect(find("content", "removed")?.expected).toBe("Second paragraph.");
    expect(find("content", "added")?.actual).toBe("Brand new paragraph.");
    expect(find("cta", "modified")?.actual).toBe("https://x.com/checkout");
    expect(find("image", "modified", "Image changed")?.actual).toBe("https://x.com/b.png");
    expect(find("image", "potentially_broken")?.description).toContain("HTTP 404");
    expect(find("link", "modified", "Link text")?.actual).toContain("About us");
    expect(find("link", "potentially_broken")?.severity).toBe("high");
    expect(find("section", "added")?.actual).toContain("newsletter");
    expect(find("responsive", "potentially_broken")?.severity).toBe("high");
    expect(find("structure", "modified")).toBeUndefined(); // outline unchanged
  });

  it("ignores cache-busting query strings on images and reports removed CTAs", () => {
    const b = page();
    const a = page({ images: [{ ...b.images[0], src: "https://x.com/a.png?v=2" }], buttons: [] });
    const c = detectChanges(b, a, ctx());
    expect(c.filter((x) => x.category === "image")).toEqual([]);
    expect(c.find((x) => x.category === "cta")?.changeType).toBe("removed");
  });
});

describe("visual diff", () => {
  const solid = (w: number, h: number, color: { r: number; g: number; b: number }) =>
    sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();

  it("reports 0% for identical images and finds the changed region", async () => {
    const base = await solid(200, 300, { r: 255, g: 255, b: 255 });
    expect((await visualDiff(base, base, { threshold: 0.1 })).diffPercent).toBe(0);
    const patch = await solid(40, 30, { r: 200, g: 0, b: 0 });
    const changed = await sharp(base).composite([{ input: patch, left: 100, top: 150 }]).png().toBuffer();
    const r = await visualDiff(base, changed, { threshold: 0.1 });
    expect(r.diffPercent).toBeCloseTo((40 * 30 * 100) / (200 * 300), 1);
    expect(r.regions).toHaveLength(1);
    expect(r.regions[0].x).toBeLessThanOrEqual(100);
    expect(r.regions[0].y).toBeLessThanOrEqual(150);
    expect(r.regions[0].x + r.regions[0].width).toBeGreaterThanOrEqual(140);
    const crop = await cropImage(changed, r.regions[0]);
    expect(crop?.subarray(0, 2).toString("hex")).toBe("ffd8"); // JPEG
  });

  it("handles images of different heights", async () => {
    const a = await solid(100, 100, { r: 255, g: 255, b: 255 });
    const b = await solid(100, 150, { r: 255, g: 255, b: 255 });
    const r = await visualDiff(a, b, { threshold: 0.1 });
    expect(r.height).toBe(150);
    expect(r.afterHeight).toBe(150);
  });

  it("findRegions separates distant changes", () => {
    const w = 100, h = 100;
    const buf = Buffer.alloc(w * h * 4, 200);
    const mark = (x: number, y: number) => buf.set([255, 0, 0, 255], (y * w + x) * 4);
    mark(5, 5);
    mark(90, 90);
    expect(findRegions(buf, w, h, 8)).toHaveLength(2);
  });
});

describe("sitemap parsing", () => {
  it("parses urlsets, indexes and robots", () => {
    expect(parseSitemap("<urlset><url><loc>https://x.com/a?x=1&amp;y=2</loc></url></urlset>").urls).toEqual(["https://x.com/a?x=1&y=2"]);
    expect(parseSitemap("<sitemapindex><sitemap><loc>https://x.com/s1.xml</loc></sitemap></sitemapindex>").sitemaps).toEqual(["https://x.com/s1.xml"]);
    expect(parseRobotsSitemaps("User-agent: *\nSitemap: https://x.com/sm.xml\n")).toEqual(["https://x.com/sm.xml"]);
  });
});
