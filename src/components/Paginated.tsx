"use client";

import { useEffect, useState } from "react";

export const PAGE_SIZE = 10;

/** Previous / Next pager. Hidden when everything fits on one page. */
export function Pager({ page, total, pageSize = PAGE_SIZE, onChange, label = "items" }: { page: number; total: number; pageSize?: number; onChange: (p: number) => void; label?: string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-3 py-2 text-sm text-slate-600">
      <span>
        Showing <strong>{from}–{to}</strong> of <strong>{total}</strong> {label}
      </span>
      <span className="flex items-center gap-2">
        <button type="button" className="btn py-1 text-xs" onClick={() => onChange(page - 1)} disabled={page <= 1}>
          ← Previous
        </button>
        <span className="text-xs text-slate-500">
          Page {page} of {pages}
        </span>
        <button type="button" className="btn py-1 text-xs" onClick={() => onChange(page + 1)} disabled={page >= pages}>
          Next →
        </button>
      </span>
    </nav>
  );
}

/** Keeps the current page valid when the number of rows changes. */
export function usePage(total: number, pageSize = PAGE_SIZE) {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  useEffect(() => {
    if (page > pages) setPage(pages);
  }, [page, pages]);
  return [Math.min(page, pages), setPage] as const;
}

/**
 * Table with a serial-number column (1 = first row, continuing across pages) and 10 rows per page.
 * Rows are rendered on the server and passed in as <td> cell groups.
 */
export default function PaginatedTable({
  headers,
  rows,
  empty,
  label = "items",
  pageSize = PAGE_SIZE,
}: {
  headers: React.ReactNode[];
  rows: Array<{ key: string | number; cells: React.ReactNode; className?: string }>;
  empty?: React.ReactNode;
  label?: string;
  pageSize?: number;
}) {
  const [page, setPage] = usePage(rows.length, pageSize);
  const start = (page - 1) * pageSize;
  const visible = rows.slice(start, start + pageSize);
  return (
    <div className="card overflow-x-auto">
      <table className="tbl">
        <thead>
          <tr>
            <th className="w-14">S.No.</th>
            {headers.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.map((r, i) => (
            <tr key={r.key} className={r.className}>
              <td className="text-slate-500 tabular-nums">{start + i + 1}</td>
              {r.cells}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && empty && <div className="p-4">{empty}</div>}
      <Pager page={page} total={rows.length} pageSize={pageSize} onChange={setPage} label={label} />
    </div>
  );
}
