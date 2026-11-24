export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-GB", { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function fmtDuration(ms: number | null | undefined): string {
  if (!ms && ms !== 0) return "—";
  if (ms < 1000) return `${ms} ms`;
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function shortUrl(url: string, base?: string): string {
  try {
    const u = new URL(url);
    if (base && new URL(base).host === u.host) return u.pathname + u.search || "/";
    return u.host + u.pathname + u.search;
  } catch {
    return url;
  }
}

export function fileUrl(key: string | null | undefined): string | null {
  return key ? `/api/files/${key}` : null;
}

export const SEVERITY_STYLE: Record<string, string> = {
  critical: "bg-red-100 text-red-800",
  high: "bg-orange-100 text-orange-800",
  medium: "bg-yellow-100 text-yellow-800",
  low: "bg-gray-100 text-gray-700",
};

export const STATUS_STYLE: Record<string, string> = {
  queued: "bg-gray-100 text-gray-700",
  running: "bg-blue-100 text-blue-800",
  completed: "bg-green-100 text-green-800",
  partial: "bg-yellow-100 text-yellow-800",
  failed: "bg-red-100 text-red-800",
  cancelled: "bg-gray-200 text-gray-700",
  captured: "bg-green-100 text-green-800",
  http_error: "bg-red-100 text-red-800",
  unchanged: "bg-green-100 text-green-800",
  changed: "bg-orange-100 text-orange-800",
  new_page: "bg-blue-100 text-blue-800",
  removed: "bg-red-100 text-red-800",
  crawl_failed: "bg-red-100 text-red-800",
  not_checked: "bg-gray-100 text-gray-700",
  pending: "bg-gray-100 text-gray-700",
  confirmed: "bg-green-100 text-green-800",
  ignored: "bg-gray-200 text-gray-600",
  flagged: "bg-purple-100 text-purple-800",
};

export const PAGE_STATUS_LABEL: Record<string, string> = {
  unchanged: "Unchanged",
  changed: "Changed",
  new_page: "New page",
  removed: "Removed (404/410)",
  http_error: "HTTP error",
  crawl_failed: "Crawl failed – not verified",
  not_checked: "Not checked",
};
