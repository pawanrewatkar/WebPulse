import { STATUS_STYLE, SEVERITY_STYLE } from "@/lib/format";

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <span className={`badge ${STATUS_STYLE[status] ?? "bg-gray-100 text-gray-700"}`}>{label ?? status.replace(/_/g, " ")}</span>;
}

export function SeverityBadge({ severity }: { severity: string }) {
  return <span className={`badge ${SEVERITY_STYLE[severity] ?? ""}`}>{severity}</span>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
        {subtitle && <div className="mt-0.5 text-sm text-gray-500">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-md border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">{children}</div>;
}

export function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="card px-4 py-3">
      <div className="text-xs font-semibold tracking-wide text-gray-500 uppercase">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${tone ?? "text-gray-900"}`}>{value}</div>
    </div>
  );
}
