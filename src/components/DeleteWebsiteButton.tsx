"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Permanently deletes a website after the user types its exact name. */
export default function DeleteWebsiteButton(props: { websiteId: number; name: string; baselines: number; comparisons: number; busy: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const matches = typed.trim() === props.name.trim();

  async function del() {
    setError(null);
    setDeleting(true);
    const res = await fetch(`/api/websites/${props.websiteId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmName: typed }),
    });
    const data = await res.json().catch(() => ({}));
    setDeleting(false);
    if (!res.ok) return setError(data.error ?? `Delete failed (${res.status})`);
    router.push("/websites");
    router.refresh();
  }

  return (
    <>
      <button type="button" className="btn border-rose-300 text-rose-700 hover:border-rose-400 hover:bg-rose-50 hover:text-rose-800" onClick={() => setOpen(true)}>
        Delete website
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => !deleting && setOpen(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="del-title" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-rose-100 text-xl text-rose-700">!</div>
            <h2 id="del-title" className="text-lg font-semibold text-slate-900">Delete “{props.name}”?</h2>
            <p className="mt-2 text-sm text-slate-600">This permanently removes the website and everything saved for it:</p>
            <ul className="mt-2 list-disc pl-5 text-sm text-slate-600">
              <li>{props.baselines} baseline version(s) with all screenshots and page data</li>
              <li>{props.comparisons} comparison(s), detected changes, review notes and reports</li>
              <li>Saved login details, ignore rules and job history</li>
            </ul>
            <p className="mt-3 text-sm font-medium text-rose-700">This cannot be undone.</p>
            {props.busy && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">A crawl or comparison is running for this website. Cancel it first.</p>}
            <label className="label mt-4" htmlFor="confirm-name">Type the website name to confirm</label>
            <input id="confirm-name" className="input" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={props.name} autoFocus autoComplete="off" />
            {error && <p className="mt-2 text-sm text-rose-700">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="btn" onClick={() => setOpen(false)} disabled={deleting}>Cancel</button>
              <button type="button" className="btn-danger" onClick={del} disabled={!matches || deleting || props.busy}>
                {deleting ? "Deleting…" : "Delete permanently"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
