import { normalizeUrl } from "../security/url";
import type { Box, ChangeCategory, ChangeType, LinkCheck, PageData, Severity } from "../types";
import { diffSequences, normalizeText, similarity, truncate } from "./text";

/** A change found by comparing two captures of the same page/device (before evidence is attached). */
export interface Detected {
  category: ChangeCategory;
  changeType: ChangeType;
  severity: Severity;
  description: string;
  expected: string | null;
  actual: string | null;
  selector: string | null;
  beforeBox?: Box | null;
  afterBox?: Box | null;
  details?: string[];
}

export interface DetectContext {
  textFilters: RegExp[];
  linkChecksBefore: Map<string, LinkCheck>;
  linkChecksAfter: Map<string, LinkCheck>;
  device: string;
}

const MAX_CONTENT_CHANGES = 40;

const safeKey = (u: string) => {
  try {
    return normalizeUrl(u);
  } catch {
    return u;
  }
};
/** Image identity ignores query strings (cache busting) and protocol. */
const imageKey = (src: string) => {
  try {
    const u = new URL(src);
    return u.host + u.pathname;
  } catch {
    return src;
  }
};

export function detectChanges(before: PageData, after: PageData, ctx: DetectContext): Detected[] {
  return [
    ...detectMetadata(before, after, ctx),
    ...detectHeadings(before, after, ctx),
    ...detectCtas(before, after, ctx),
    ...detectContent(before, after, ctx),
    ...detectSections(before, after, ctx),
    ...detectImages(before, after, ctx),
    ...detectLinks(before, after, ctx),
    ...detectForms(before, after),
    ...detectStructure(before, after),
    ...detectResponsive(before, after, ctx),
  ];
}

function fieldChange(category: ChangeCategory, label: string, a: string, b: string, severity: Severity): Detected | null {
  if (a === b) return null;
  const changeType: ChangeType = !a ? "added" : !b ? "removed" : "modified";
  const verb = changeType === "added" ? "added" : changeType === "removed" ? "removed" : "changed";
  return { category, changeType, severity, description: `${label} ${verb}`, expected: a || null, actual: b || null, selector: null };
}

export function detectMetadata(b: PageData, a: PageData, ctx: DetectContext): Detected[] {
  const n = (s: string) => normalizeText(s ?? "", ctx.textFilters);
  const out: (Detected | null)[] = [
    fieldChange("metadata", "Page title", n(b.title), n(a.title), "medium"),
    fieldChange("metadata", "Meta description", n(b.meta.description), n(a.meta.description), "medium"),
    fieldChange("metadata", "Canonical URL", b.meta.canonical ? safeKey(b.meta.canonical) : "", a.meta.canonical ? safeKey(a.meta.canonical) : "", "medium"),
    fieldChange("metadata", "Meta keywords", n(b.meta.keywords), n(a.meta.keywords), "low"),
    fieldChange("metadata", "Page language (lang)", b.lang, a.lang, "low"),
    fieldChange("metadata", "Viewport meta tag", b.meta.viewport, a.meta.viewport, "medium"),
  ];
  // Robots: becoming noindex/nofollow is critical for SEO.
  const rb = (b.meta.robots || "").toLowerCase();
  const ra = (a.meta.robots || "").toLowerCase();
  if (rb !== ra) {
    const nowBlocked = /noindex/.test(ra) && !/noindex/.test(rb);
    out.push({ ...fieldChange("metadata", "Robots meta tag", rb, ra, nowBlocked ? "critical" : "high")!, description: nowBlocked ? "Page is now set to NOINDEX (removed from search engines)" : "Robots meta tag changed" });
  }
  for (const key of new Set([...Object.keys(b.meta.og), ...Object.keys(a.meta.og)])) {
    out.push(fieldChange("metadata", `Open Graph ${key}`, n(b.meta.og[key] ?? ""), n(a.meta.og[key] ?? ""), "low"));
  }
  // Redirect target changes.
  const fb = safeKey(b.finalUrl);
  const fa = safeKey(a.finalUrl);
  if (fb !== fa && (safeKey(b.url) !== fb || safeKey(a.url) !== fa)) {
    out.push({ category: "metadata", changeType: "modified", severity: "high", description: "Page now redirects to a different URL", expected: fb, actual: fa, selector: null });
  }
  return out.filter((x): x is Detected => !!x);
}

export function detectHeadings(b: PageData, a: PageData, ctx: DetectContext): Detected[] {
  const key = (h: PageData["headings"][number]) => `H${h.level}: ${normalizeText(h.text, ctx.textFilters)}`;
  const out: Detected[] = [];
  const sev = (level: number): Severity => (level === 1 ? "high" : level === 2 ? "medium" : "low");
  for (const hunk of diffSequences(b.headings, a.headings, key)) {
    const pairs = Math.min(hunk.removed.length, hunk.added.length);
    for (let i = 0; i < pairs; i++) {
      const r = hunk.removed[i];
      const ad = hunk.added[i];
      out.push({ category: "heading", changeType: "modified", severity: sev(Math.min(r.level, ad.level)), description: `H${ad.level} heading changed`, expected: key(r), actual: key(ad), selector: ad.selector, beforeBox: r.box, afterBox: ad.box });
    }
    for (const r of hunk.removed.slice(pairs)) out.push({ category: "heading", changeType: "removed", severity: sev(r.level), description: `H${r.level} heading removed`, expected: key(r), actual: null, selector: r.selector, beforeBox: r.box });
    for (const ad of hunk.added.slice(pairs)) out.push({ category: "heading", changeType: "added", severity: ad.level === 1 ? "medium" : "low", description: `H${ad.level} heading added`, expected: null, actual: key(ad), selector: ad.selector, afterBox: ad.box });
  }
  return out;
}

export function detectCtas(b: PageData, a: PageData, ctx: DetectContext): Detected[] {
  const norm = (t: string) => normalizeText(t, ctx.textFilters).toLowerCase();
  const index = (d: PageData) => {
    const m = new Map<string, PageData["buttons"][number]>();
    for (const x of d.buttons) if (!m.has(norm(x.text))) m.set(norm(x.text), x);
    return m;
  };
  const mb = index(b);
  const ma = index(a);
  const out: Detected[] = [];
  for (const [k, x] of mb) {
    const y = ma.get(k);
    if (!y) out.push({ category: "cta", changeType: "removed", severity: "high", description: `Button/CTA "${x.text}" removed`, expected: x.text + (x.href ? ` → ${x.href}` : ""), actual: null, selector: x.selector, beforeBox: x.box });
    else if ((x.href ? safeKey(x.href) : "") !== (y.href ? safeKey(y.href) : ""))
      out.push({ category: "cta", changeType: "modified", severity: "high", description: `Button/CTA "${y.text}" now points to a different URL`, expected: x.href, actual: y.href, selector: y.selector, beforeBox: x.box, afterBox: y.box });
  }
  for (const [k, y] of ma) {
    if (!mb.has(k)) out.push({ category: "cta", changeType: "added", severity: "medium", description: `Button/CTA "${y.text}" added`, expected: null, actual: y.text + (y.href ? ` → ${y.href}` : ""), selector: y.selector, afterBox: y.box });
  }
  return out;
}

export function detectContent(b: PageData, a: PageData, ctx: DetectContext): Detected[] {
  const prep = (d: PageData) =>
    d.textBlocks.map((t) => ({ ...t, n: normalizeText(t.text, ctx.textFilters) })).filter((t) => /[\p{L}\p{N}]/u.test(t.n)); // skip separators/punctuation-only
  const out: Detected[] = [];
  for (const hunk of diffSequences(prep(b), prep(a), (t) => t.n)) {
    // Pair removed/added blocks that are similar as "modified"; the rest are removals/additions.
    const added = [...hunk.added];
    const removedLeft: typeof hunk.removed = [];
    for (const r of hunk.removed) {
      let best = added.length && hunk.removed.length === 1 && hunk.added.length === 1 ? 0 : -1;
      let bestScore = best === 0 ? similarity(r.n, added[0].n) : 0;
      added.forEach((x, i) => {
        const s = similarity(r.n, x.n);
        if (s > bestScore) (bestScore = s), (best = i);
      });
      if (best >= 0 && (bestScore >= 0.3 || (hunk.removed.length === 1 && hunk.added.length === 1))) {
        const x = added.splice(best, 1)[0];
        out.push({ category: "content", changeType: "modified", severity: "medium", description: `Text changed (${r.tag})`, expected: truncate(r.n, 1000), actual: truncate(x.n, 1000), selector: x.selector, beforeBox: r.box, afterBox: x.box });
      } else removedLeft.push(r);
    }
    if (removedLeft.length > 3) {
      out.push({ category: "content", changeType: "removed", severity: "high", description: `${removedLeft.length} consecutive text blocks removed`, expected: truncate(removedLeft.map((r) => r.n).join("\n"), 1500), actual: null, selector: removedLeft[0].selector, beforeBox: removedLeft[0].box });
    } else for (const r of removedLeft) out.push({ category: "content", changeType: "removed", severity: "medium", description: `Text removed (${r.tag})`, expected: truncate(r.n, 1000), actual: null, selector: r.selector, beforeBox: r.box });
    if (added.length > 3) {
      out.push({ category: "content", changeType: "added", severity: "low", description: `${added.length} consecutive text blocks added`, expected: null, actual: truncate(added.map((r) => r.n).join("\n"), 1500), selector: added[0].selector, afterBox: added[0].box });
    } else for (const x of added) out.push({ category: "content", changeType: "added", severity: "low", description: `Text added (${x.tag})`, expected: null, actual: truncate(x.n, 1000), selector: x.selector, afterBox: x.box });
  }
  if (out.length > MAX_CONTENT_CHANGES) {
    const rest = out.length - MAX_CONTENT_CHANGES;
    return [...out.slice(0, MAX_CONTENT_CHANGES), { category: "content", changeType: "modified", severity: "medium", description: `${rest} further text changes on this page (not listed individually)`, expected: null, actual: null, selector: null }];
  }
  return out;
}

export function detectSections(b: PageData, a: PageData, ctx: DetectContext): Detected[] {
  const sig = (s: PageData["sections"][number]) =>
    `${s.tag}${s.id ? "#" + s.id : s.classes ? "." + s.classes.split(" ")[0] : ""}${s.heading ? ` "${normalizeText(s.heading, ctx.textFilters)}"` : ""}`;
  // Only top-level-ish, meaningful sections (with id, role, heading or landmark tag).
  const keep = (s: PageData["sections"][number]) => !!(s.id || s.heading || s.role || ["header", "nav", "main", "footer", "aside", "form"].includes(s.tag));
  const out: Detected[] = [];
  for (const hunk of diffSequences(b.sections.filter(keep), a.sections.filter(keep), sig)) {
    const addedSigs = new Set(hunk.added.map(sig));
    for (const r of hunk.removed) {
      // A section whose heading changed shows up as remove+add with the same tag/id: report as modified.
      const twin = hunk.added.find((x) => x.tag === r.tag && x.id && x.id === r.id);
      if (twin) {
        addedSigs.delete(sig(twin));
        out.push({ category: "section", changeType: "modified", severity: "medium", description: `Section ${sig(twin).split(" ")[0]} changed`, expected: sig(r), actual: sig(twin), selector: twin.selector, beforeBox: r.box, afterBox: twin.box });
      } else out.push({ category: "section", changeType: "removed", severity: "high", description: `Section removed: ${sig(r)}`, expected: `${sig(r)} – ${truncate(r.textSample, 160)}`, actual: null, selector: r.selector, beforeBox: r.box });
    }
    for (const x of hunk.added) {
      if (!addedSigs.has(sig(x))) continue;
      out.push({ category: "section", changeType: "added", severity: "medium", description: `Section added: ${sig(x)}`, expected: null, actual: `${sig(x)} – ${truncate(x.textSample, 160)}`, selector: x.selector, afterBox: x.box });
    }
  }
  return out;
}

export function detectImages(b: PageData, a: PageData, ctx: DetectContext): Detected[] {
  const out: Detected[] = [];
  const group = (d: PageData) => {
    const m = new Map<string, PageData["images"][number]>();
    for (const i of d.images) if (!m.has(imageKey(i.src))) m.set(imageKey(i.src), i);
    return m;
  };
  const mb = group(b);
  const ma = group(a);
  const removed = [...mb.entries()].filter(([k]) => !ma.has(k)).map(([, v]) => v);
  const added = [...ma.entries()].filter(([k]) => !mb.has(k)).map(([, v]) => v);

  const isBroken = (img: PageData["images"][number], checks: Map<string, LinkCheck>) => {
    if (img.loaded) return { broken: false, verified: true, status: null as number | null };
    const c = checks.get(safeKey(img.src));
    if (c) return { broken: !c.ok, verified: true, status: c.status };
    return { broken: true, verified: false, status: null };
  };

  // Pair a removed and an added image with the same alt text / position as "image changed".
  for (const r of [...removed]) {
    const twin = added.find((x) => (r.alt && x.alt === r.alt) || x.selector === r.selector);
    if (!twin) continue;
    removed.splice(removed.indexOf(r), 1);
    added.splice(added.indexOf(twin), 1);
    out.push({ category: "image", changeType: "modified", severity: "medium", description: `Image changed${r.alt ? ` ("${r.alt}")` : ""}: different image URL`, expected: r.src, actual: twin.src, selector: twin.selector, beforeBox: r.box, afterBox: twin.box });
    const br = isBroken(twin, ctx.linkChecksAfter);
    if (br.broken) out.push(brokenImage(twin, br));
  }
  for (const r of removed) out.push({ category: "image", changeType: "removed", severity: "medium", description: `Image removed${r.alt ? ` ("${r.alt}")` : ""}`, expected: r.src, actual: null, selector: r.selector, beforeBox: r.box });
  for (const x of added) {
    const br = isBroken(x, ctx.linkChecksAfter);
    if (br.broken) out.push(brokenImage(x, br));
    else out.push({ category: "image", changeType: "added", severity: "low", description: `Image added${x.alt ? ` ("${x.alt}")` : ""}`, expected: null, actual: x.src, selector: x.selector, afterBox: x.box });
  }
  for (const [k, x] of ma) {
    const y = mb.get(k);
    if (!y) continue;
    if (normalizeText(y.alt, []) !== normalizeText(x.alt, []))
      out.push({ category: "image", changeType: "modified", severity: "low", description: "Image alt text changed", expected: y.alt || "(empty)", actual: x.alt || "(empty)", selector: x.selector, beforeBox: y.box, afterBox: x.box });
    const nowBroken = isBroken(x, ctx.linkChecksAfter);
    const wasBroken = isBroken(y, ctx.linkChecksBefore);
    if (nowBroken.broken && !wasBroken.broken) out.push(brokenImage(x, nowBroken));
    else if (y.loaded && x.loaded && y.naturalWidth && x.naturalWidth && (y.naturalWidth !== x.naturalWidth || y.naturalHeight !== x.naturalHeight))
      out.push({ category: "image", changeType: "modified", severity: "low", description: "Image dimensions changed (same URL, different file)", expected: `${y.naturalWidth}×${y.naturalHeight}`, actual: `${x.naturalWidth}×${x.naturalHeight}`, selector: x.selector, beforeBox: y.box, afterBox: x.box });
  }
  return out;
}

function brokenImage(img: PageData["images"][number], br: { verified: boolean; status: number | null }): Detected {
  return {
    category: "image",
    changeType: "potentially_broken",
    severity: br.verified ? "high" : "medium",
    description: br.verified ? `Broken image${img.alt ? ` ("${img.alt}")` : ""}: ${br.status ? `HTTP ${br.status}` : "request failed"}` : `Image did not render${img.alt ? ` ("${img.alt}")` : ""} (not verified over HTTP)`,
    expected: "Image loads",
    actual: `${img.src}${br.status ? ` → HTTP ${br.status}` : ""}`,
    selector: img.selector,
    afterBox: img.box,
  };
}

export function detectLinks(b: PageData, a: PageData, ctx: DetectContext): Detected[] {
  const out: Detected[] = [];
  const index = (d: PageData) => {
    const m = new Map<string, PageData["links"][number]>();
    for (const l of d.links) {
      if (!/^https?:/i.test(l.href)) continue;
      const k = safeKey(l.href);
      if (!m.has(k)) m.set(k, l);
    }
    return m;
  };
  const mb = index(b);
  const ma = index(a);
  const removed = [...mb.entries()].filter(([k]) => !ma.has(k));
  const added = [...ma.entries()].filter(([k]) => !mb.has(k));
  const label = (l: PageData["links"][number]) => `${l.text || "(no text)"} → ${l.href}`;

  if (removed.length > 8) out.push({ category: "link", changeType: "removed", severity: "medium", description: `${removed.length} links removed`, expected: truncate(removed.map(([, l]) => label(l)).join("\n"), 2000), actual: null, selector: null });
  else for (const [, l] of removed) out.push({ category: "link", changeType: "removed", severity: "medium", description: `Link removed: "${l.text || l.href}"`, expected: label(l), actual: null, selector: l.selector, beforeBox: l.box });
  if (added.length > 8) out.push({ category: "link", changeType: "added", severity: "low", description: `${added.length} links added`, expected: null, actual: truncate(added.map(([, l]) => label(l)).join("\n"), 2000), selector: null });
  else for (const [, l] of added) out.push({ category: "link", changeType: "added", severity: "low", description: `Link added: "${l.text || l.href}"`, expected: null, actual: label(l), selector: l.selector, afterBox: l.box });

  for (const [k, l] of ma) {
    const old = mb.get(k);
    if (old && normalizeText(old.text, ctx.textFilters) !== normalizeText(l.text, ctx.textFilters) && (old.text || l.text))
      out.push({ category: "link", changeType: "modified", severity: "low", description: "Link text changed", expected: label(old), actual: label(l), selector: l.selector, beforeBox: old.box, afterBox: l.box });
    const check = ctx.linkChecksAfter.get(k);
    if (check && !check.ok) {
      const before = ctx.linkChecksBefore.get(k);
      const preExisting = !!(old && before && !before.ok);
      out.push({
        category: "link",
        changeType: "potentially_broken",
        severity: preExisting ? "low" : "high",
        description: `${preExisting ? "Broken link (already broken in baseline)" : "Broken link"}: "${l.text || l.href}"`,
        expected: "Link target responds with HTTP 2xx/3xx",
        actual: `${l.href} → ${check.status ? `HTTP ${check.status}` : check.error ?? "request failed"}`,
        selector: l.selector,
        afterBox: l.box,
      });
    }
  }
  return out;
}

export function detectForms(b: PageData, a: PageData): Detected[] {
  const out: Detected[] = [];
  const key = (f: PageData["forms"][number]) => f.action || f.selector;
  const fields = (f: PageData["forms"][number]) => f.fields.map((x) => `${x.name || x.label}:${x.type}`);
  const mb = new Map(b.forms.map((f) => [key(f), f]));
  const ma = new Map(a.forms.map((f) => [key(f), f]));
  for (const [k, f] of mb) {
    const g = ma.get(k);
    if (!g) {
      out.push({ category: "form", changeType: "removed", severity: "high", description: `Form removed (${f.method.toUpperCase()} ${f.action || f.selector})`, expected: fields(f).join(", "), actual: null, selector: f.selector, beforeBox: f.box });
      continue;
    }
    const fb = fields(f);
    const fa = fields(g);
    const rem = fb.filter((x) => !fa.includes(x));
    const add = fa.filter((x) => !fb.includes(x));
    if (rem.length || add.length)
      out.push({
        category: "form",
        changeType: "modified",
        severity: rem.length ? "high" : "medium",
        description: `Form fields changed${add.length ? `: added ${add.join(", ")}` : ""}${rem.length ? `${add.length ? ";" : ":"} removed ${rem.join(", ")}` : ""}`,
        expected: fb.join(", "),
        actual: fa.join(", "),
        selector: g.selector,
        beforeBox: f.box,
        afterBox: g.box,
      });
  }
  for (const [k, g] of ma) if (!mb.has(k)) out.push({ category: "form", changeType: "added", severity: "medium", description: `Form added (${g.method.toUpperCase()} ${g.action || g.selector})`, expected: null, actual: fields(g).join(", "), selector: g.selector, afterBox: g.box });
  return out;
}

export function detectStructure(b: PageData, a: PageData): Detected[] {
  const hunks = diffSequences(b.outline, a.outline, (x) => x);
  const removed = hunks.reduce((n, h) => n + h.removed.length, 0);
  const added = hunks.reduce((n, h) => n + h.added.length, 0);
  if (removed + added < 2) return [];
  const ratio = (removed + added) / Math.max(1, b.outline.length);
  const details: string[] = [];
  for (const h of hunks) {
    for (const r of h.removed) details.push(`- ${r}`);
    for (const x of h.added) details.push(`+ ${x}`);
    if (details.length > 60) break;
  }
  return [
    {
      category: "structure",
      changeType: "modified",
      severity: ratio > 0.3 ? "high" : ratio > 0.1 ? "medium" : "low",
      description: `DOM structure changed: ${added} element group(s) added, ${removed} removed (${b.domStats.elementCount} → ${a.domStats.elementCount} elements)`,
      expected: `${b.outline.length} outline nodes, ${b.domStats.elementCount} elements, depth ${b.domStats.maxDepth}`,
      actual: `${a.outline.length} outline nodes, ${a.domStats.elementCount} elements, depth ${a.domStats.maxDepth}`,
      selector: null,
      details: details.slice(0, 60),
    },
  ];
}

export function detectResponsive(b: PageData, a: PageData, ctx: DetectContext): Detected[] {
  if (a.layout.horizontalOverflow && !b.layout.horizontalOverflow) {
    return [
      {
        category: "responsive",
        changeType: "potentially_broken",
        severity: ctx.device === "mobile" ? "high" : "medium",
        description: `Horizontal overflow on ${ctx.device}: content is wider than the viewport`,
        expected: `Content fits viewport (${b.layout.scrollWidth}px ≤ ${b.layout.viewportWidth}px)`,
        actual: `Page is ${a.layout.scrollWidth}px wide on a ${a.layout.viewportWidth}px viewport (horizontal scrolling)`,
        selector: null,
      },
    ];
  }
  if (a.layout.horizontalOverflow && b.layout.horizontalOverflow && a.layout.scrollWidth - b.layout.scrollWidth > 20) {
    return [
      {
        category: "responsive",
        changeType: "potentially_broken",
        severity: "medium",
        description: `Horizontal overflow on ${ctx.device} got worse (already present in baseline)`,
        expected: `${b.layout.scrollWidth}px wide on ${b.layout.viewportWidth}px viewport (baseline)`,
        actual: `${a.layout.scrollWidth}px wide on ${a.layout.viewportWidth}px viewport`,
        selector: null,
      },
    ];
  }
  if (!a.layout.horizontalOverflow && b.layout.horizontalOverflow) {
    return [{ category: "responsive", changeType: "modified", severity: "low", description: `Horizontal overflow on ${ctx.device} fixed`, expected: `${b.layout.scrollWidth}px wide`, actual: `${a.layout.scrollWidth}px wide`, selector: null }];
  }
  return [];
}
