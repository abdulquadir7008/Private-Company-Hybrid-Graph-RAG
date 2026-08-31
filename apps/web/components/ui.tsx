import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-slate-800 bg-ink-900 p-4 ${className}`}>{children}</div>;
}

export function Button({
  children,
  onClick,
  type = "button",
  variant = "primary",
  disabled = false,
  className = ""
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  variant?: "primary" | "ghost" | "danger";
  disabled?: boolean;
  className?: string;
}) {
  const styles =
    variant === "primary"
      ? "bg-indigo-600 text-white hover:bg-indigo-500"
      : variant === "danger"
        ? "bg-rose-600/80 text-white hover:bg-rose-600"
        : "bg-slate-800 text-slate-200 hover:bg-slate-700";
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-lg border border-slate-800 bg-ink-950 px-3 py-2 text-sm text-slate-200 outline-none transition placeholder:text-slate-500 focus:border-indigo-500 ${props.className ?? ""}`}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full rounded-lg border border-slate-800 bg-ink-950 px-3 py-2 text-sm text-slate-200 outline-none focus:border-indigo-500 ${props.className ?? ""}`}
    />
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-400">{children}</label>;
}

export function Badge({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "green" | "amber" | "rose" | "indigo" | "cyan" }) {
  const map: Record<string, string> = {
    slate: "bg-slate-800 text-slate-300",
    green: "bg-emerald-500/15 text-emerald-300",
    amber: "bg-amber-500/15 text-amber-300",
    rose: "bg-rose-500/15 text-rose-300",
    indigo: "bg-indigo-500/15 text-indigo-300",
    cyan: "bg-cyan-500/15 text-cyan-300"
  };
  return <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium ${map[tone]}`}>{children}</span>;
}

export function Spinner({ label = "Working…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-400">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-indigo-400" />
      {label}
    </div>
  );
}

export function Stat({ label, value, accent = false }: { label: string; value: ReactNode; accent?: boolean }) {
  return (
    <Card>
      <div className={`text-2xl font-semibold ${accent ? "text-indigo-300" : "text-slate-100"}`}>{value}</div>
      <div className="mt-1 text-xs uppercase tracking-wide text-slate-500">{label}</div>
    </Card>
  );
}

export function EmptyState({ icon = "✦", title, hint }: { icon?: string; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-800 py-16 text-center">
      <div className="text-3xl text-slate-600">{icon}</div>
      <div className="mt-3 text-sm font-medium text-slate-300">{title}</div>
      {hint && <div className="mt-1 max-w-sm text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

export function Alert({ tone = "rose", children }: { tone?: "rose" | "green" | "amber"; children: ReactNode }) {
  const map: Record<string, string> = {
    rose: "border-rose-500/30 bg-rose-500/10 text-rose-200",
    green: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
    amber: "border-amber-500/30 bg-amber-500/10 text-amber-200"
  };
  return <div className={`rounded-lg border px-3 py-2 text-sm ${map[tone]}`}>{children}</div>;
}

export function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export function formatDate(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function statusTone(status: string): "slate" | "green" | "amber" | "rose" | "indigo" | "cyan" {
  switch (status.toUpperCase()) {
    case "INDEXED":
    case "COMPLETED":
    case "ACTIVE":
    case "HELPFUL":
      return "green";
    case "PROCESSING":
    case "RUNNING":
    case "UPLOADED":
    case "PENDING":
      return "amber";
    case "FAILED":
    case "SUSPENDED":
    case "NOT_HELPFUL":
      return "rose";
    case "SUPERSEDED":
      return "indigo";
    default:
      return "slate";
  }
}