"use client";

import { useEffect, useState } from "react";
import type { IgnoreRule } from "@core/types";
import { fmtDate } from "@/lib/format";

/** Lists "always ignore" rules created from the review screen; each can be removed. */
export default function IgnoreRules({ websiteId }: { websiteId: number }) {
  const [rules, setRules] = useState<IgnoreRule[] | null>(null);
  const load = () => fetch(`/api/websites/${websiteId}/ignore-rules`, { cache: "no-store" }).then((r) => r.json()).then((d) => setRules(d.rules));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [websiteId]);
  if (!rules?.length) return null;
  return (
    <section>
      <h2 className="mb-2 font-semibold">“Always ignore” rules ({rules.length})</h2>
      <div className="card overflow-x-auto">
        <table className="tbl">
          <thead><tr><th>Ignored change</th><th>Created</th><th></th></tr></thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id}>
                <td className="text-gray-700">{r.description ?? r.fingerprint}</td>
                <td className="whitespace-nowrap text-gray-500">{fmtDate(r.createdAt)}</td>
                <td className="text-right">
                  <button className="btn py-0.5 text-xs" onClick={async () => { await fetch(`/api/websites/${websiteId}/ignore-rules?ruleId=${r.id}`, { method: "DELETE" }); load(); }}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
