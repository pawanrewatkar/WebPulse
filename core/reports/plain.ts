/**
 * Plain-language wording for detected changes, shared by the web UI and the PDF report.
 * Pure functions with no Node.js imports (safe to use in browser components).
 */
import type { ChangeCategory, ChangeType, Severity } from "../types";

interface ChangeLike {
  category: ChangeCategory;
  changeType: ChangeType;
  description: string;
}

/** Short, non-technical title such as "Button removed" or "Link leads to an error page". */
export function friendlyTitle(c: ChangeLike): string {
  const t = c.changeType;
  const d = c.description;
  switch (c.category) {
    case "page":
      if (t === "removed") return "Page removed (no longer found)";
      if (t === "added") return /linked from the site returns/.test(d) ? "New link leads to an error page" : "New page";
      if (t === "potentially_broken") return /could not be loaded/.test(d) ? "Page could not be loaded" : "Page shows an error";
      return "Page status changed";
    case "visual":
      return "Page looks different";
    case "content":
      return t === "added" ? "Text added" : t === "removed" ? "Text removed" : "Text changed";
    case "heading":
      return t === "added" ? "Heading added" : t === "removed" ? "Heading removed" : "Heading changed";
    case "cta":
      return t === "added" ? "Button added" : t === "removed" ? "Button removed" : "Button now links somewhere else";
    case "image":
      if (t === "potentially_broken") return "Image is broken";
      return t === "added" ? "Image added" : t === "removed" ? "Image removed" : "Image changed";
    case "link":
      if (t === "potentially_broken") return "Link leads to an error page";
      return t === "added" ? "Link added" : t === "removed" ? "Link removed" : "Link text changed";
    case "metadata":
      if (/title/i.test(d)) return "Page title changed (shown in Google and the browser tab)";
      if (/description/i.test(d)) return "Google description changed";
      if (/noindex/i.test(d)) return "Page hidden from Google";
      if (/redirect/i.test(d)) return "Page now redirects elsewhere";
      return "Search/sharing information changed";
    case "section":
      return t === "added" ? "New section on the page" : t === "removed" ? "Section missing from the page" : "Section changed";
    case "structure":
      return "Page code structure changed (technical)";
    case "form":
      return t === "added" ? "Form added" : t === "removed" ? "Form removed" : "Form fields changed";
    case "responsive":
      return t === "potentially_broken" ? "Page does not fit the screen" : "Screen-fit problem fixed";
    default:
      return d;
  }
}

/** One-line advice on what to do about the change. */
export function whatToDo(c: ChangeLike): string {
  if (c.category === "page" && /could not be loaded/.test(c.description))
    return "Open the page in your browser. If it loads, the site was probably slow or busy – click Retry or run the comparison again.";
  if (c.changeType === "potentially_broken") return "This looks broken for visitors. Check it and ask the website team to fix it.";
  if (c.category === "page" && c.changeType === "removed") return "Check whether the page was removed on purpose. If not, it needs to be restored or redirected.";
  if (c.category === "structure") return "Usually only relevant for developers. Ignore it unless other changes on this page look wrong.";
  if (c.changeType === "removed") return "Check whether this was removed on purpose.";
  if (c.changeType === "added") return "Check that this new content is correct and intended.";
  return "Compare before and now. If the change was intended, click Confirm; otherwise report it.";
}

export const SEVERITY_MEANING: Record<Severity, string> = {
  critical: "Critical – a page is broken or gone",
  high: "High – visitors will very likely notice",
  medium: "Medium – worth checking",
  low: "Low – minor detail",
};

/** Colour used to outline the change: green for new things, red otherwise. */
export function highlightColor(c: { changeType: ChangeType }): string {
  return c.changeType === "added" ? "#16a34a" : "#dc2626";
}
