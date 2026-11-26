import { STATUS_STYLE, SEVERITY_STYLE } from "@/lib/format";

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <span className={`badge ${STATUS_STYLE[status] ?? "bg-gray-100 text-gray-700"}`}>{label ?? status.replace(/_/g, " ")}</span>;
}

export function SeverityBadge({ severity }: { severity: string }) {
  return <span className={`badge ${SEVERITY_STYLE[severity] ?? ""}`}>{severity}</span>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="bg-linear-to-r from-indigo-800 via-violet-700 to-fuchsia-600 bg-clip-text text-2xl font-bold tracking-tight text-transparent">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-slate-500">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-dashed border-indigo-200 bg-indigo-50/40 p-6 text-center text-sm text-slate-600">{children}</div>;
}

export type Accent = "indigo" | "violet" | "sky" | "emerald" | "amber" | "rose" | "fuchsia" | "slate";

const ACCENTS: Record<Accent, { bar: string; label: string; bg: string }> = {
  indigo: { bar: "from-indigo-500 to-indigo-600", label: "text-indigo-700", bg: "from-indigo-50" },
  violet: { bar: "from-violet-500 to-purple-600", label: "text-violet-700", bg: "from-violet-50" },
  sky: { bar: "from-sky-400 to-blue-600", label: "text-sky-700", bg: "from-sky-50" },
  emerald: { bar: "from-emerald-400 to-teal-600", label: "text-emerald-700", bg: "from-emerald-50" },
  amber: { bar: "from-amber-400 to-orange-500", label: "text-amber-700", bg: "from-amber-50" },
  rose: { bar: "from-rose-400 to-red-600", label: "text-rose-700", bg: "from-rose-50" },
  fuchsia: { bar: "from-fuchsia-400 to-pink-600", label: "text-fuchsia-700", bg: "from-fuchsia-50" },
  slate: { bar: "from-slate-300 to-slate-500", label: "text-slate-600", bg: "from-slate-50" },
};

export function Stat({ label, value, tone, accent = "indigo" }: { label: string; value: React.ReactNode; tone?: string; accent?: Accent }) {
  const a = ACCENTS[accent];
  return (
    <div className={`card relative overflow-hidden bg-linear-to-br ${a.bg} to-white px-4 py-3`}>
      <div className={`absolute inset-x-0 top-0 h-1 bg-linear-to-r ${a.bar}`} />
      <div className={`text-xs font-semibold tracking-wide uppercase ${a.label}`}>{label}</div>
      <div className={`mt-1 text-3xl font-bold ${tone ?? "text-slate-900"}`}>{value}</div>
    </div>
  );
}
