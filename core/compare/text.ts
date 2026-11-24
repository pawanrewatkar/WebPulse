import { diffArrays } from "diff";
import { patternToRegExp } from "../security/url";
import { BUILTIN_IGNORE_TEXT, type WebsiteSettings } from "../settings";

export function buildTextFilters(settings: WebsiteSettings): RegExp[] {
  const pats = [...(settings.builtInNoiseFilters ? BUILTIN_IGNORE_TEXT : []), ...settings.ignoreTextPatterns];
  return pats
    .map((p) => patternToRegExp(p))
    .filter((r): r is RegExp => !!r)
    .map((r) => (r.global ? r : new RegExp(r.source, r.flags + "g")));
}

/** Normalises text for comparison: removes ignored patterns (timestamps etc.) and collapses whitespace. */
export function normalizeText(text: string, filters: RegExp[]): string {
  let t = text;
  for (const f of filters) t = t.replace(f, "");
  return t.replace(/[\s ​]+/g, " ").trim();
}

export interface Hunk<T> {
  removed: T[];
  added: T[];
}

/** Sequence diff returning only the changed hunks (removed/added items grouped where adjacent). */
export function diffSequences<T>(before: T[], after: T[], key: (x: T) => string): Hunk<T>[] {
  const a = before.map(key);
  const b = after.map(key);
  const parts = diffArrays(a, b);
  const hunks: Hunk<T>[] = [];
  let ia = 0;
  let ib = 0;
  let cur: Hunk<T> | null = null;
  for (const p of parts) {
    const n = p.count ?? p.value.length;
    if (p.removed) {
      cur ??= { removed: [], added: [] };
      cur.removed.push(...before.slice(ia, ia + n));
      ia += n;
    } else if (p.added) {
      cur ??= { removed: [], added: [] };
      cur.added.push(...after.slice(ib, ib + n));
      ib += n;
    } else {
      if (cur) hunks.push(cur);
      cur = null;
      ia += n;
      ib += n;
    }
  }
  if (cur) hunks.push(cur);
  return hunks;
}

/** Dice coefficient on words + word bigrams – cheap similarity score in [0, 1]. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const grams = (s: string) => {
    const w = s.toLowerCase().split(/\s+/).filter(Boolean);
    const out = new Map<string, number>();
    const add = (k: string) => out.set(k, (out.get(k) ?? 0) + 1);
    for (const x of w) add(x);
    for (let i = 0; i < w.length - 1; i++) add(w[i] + " " + w[i + 1]);
    return out;
  };
  const ga = grams(a);
  const gb = grams(b);
  let inter = 0;
  let total = 0;
  for (const v of ga.values()) total += v;
  for (const v of gb.values()) total += v;
  for (const [k, v] of ga) inter += Math.min(v, gb.get(k) ?? 0);
  return total ? (2 * inter) / total : 0;
}

export function truncate(s: string | null | undefined, n = 300): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
