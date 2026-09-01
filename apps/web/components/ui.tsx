import type { ReactNode } from "react";

export type BadgeTone = "slate" | "green" | "amber" | "rose" | "indigo" | "cyan" | "violet";

const BADGE_TONES: Record<BadgeTone, string> = {
  slate: "bg-slate-800 text-slate-300 ring-slate-700/40",
  green: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  amber: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  rose: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  indigo: "bg-indigo-500/15 text-indigo-300 ring-indigo-500/30",
  cyan: "bg-cyan-500/15 text-cyan-300 ring-cyan-500/30",
  violet: "bg-violet-500/15 text-violet-300 ring-violet-500/30"
};

const BTN_VARIANTS: Record<string, string> = {
  primary:
    "bg-gradient-to-b from-pink-500 to-rose-500 text-white shadow-lg shadow-rose-200/80 hover:from-pink-400 hover:to-rose-400",
  outline: "border border-rose-100 bg-white text-slate-700 shadow-sm hover:border-rose-300 hover:text-rose-600",
  ghost: "bg-transparent text-slate-600 hover:bg-rose-50 hover:text-rose-600",
  danger: "bg-rose-600/85 text-white hover:bg-rose-600"
};

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-rose-100 bg-surface/90 p-4 shadow-[0_10px_28px_rgba(190,24,93,0.06)] backdrop-blur-sm ${className}`}>{children}</div>
  );
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-rose-100 bg-base-900/90 shadow-[0_10px_28px_rgba(190,24,93,0.05)] backdrop-blur-sm ${className}`}>{children}</div>
  );
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
  variant?: "primary" | "ghost" | "danger" | "outline";
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${BTN_VARIANTS[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

const INPUT_CLS =
  "w-full rounded-lg border border-rose-100 bg-white px-3 py-2 text-sm text-slate-800 outline-none shadow-sm transition placeholder:text-slate-400 focus:border-brand focus:ring-4 focus:ring-rose-100";
const SELECT_CLS =
  "w-full rounded-lg border border-rose-100 bg-white px-3 py-2 text-sm text-slate-800 outline-none shadow-sm transition focus:border-brand focus:ring-4 focus:ring-rose-100";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${INPUT_CLS} ${props.className ?? ""}`} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${SELECT_CLS} ${props.className ?? ""}`} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${INPUT_CLS} resize-none ${props.className ?? ""}`} />;
}

export function Label({ children }: { children: ReactNode }) {
  return <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">{children}</label>;
}

export function Badge({ children, tone = "slate" }: { children: ReactNode; tone?: BadgeTone }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${BADGE_TONES[tone]}`}>
      {children}
    </span>
  );
}

export function EntityBadge({
  name,
  type,
  color
}: {
  name: string;
  type?: string | null;
  color?: string | null;
}) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{
          backgroundColor: color ?? type ?? "#94a3b8",
          boxShadow: `0 0 8px ${(color ?? type ?? "#94a3b8")}66`
        }}
      />
      <span className="truncate text-sm font-medium text-slate-100">{name}</span>
      {type && <Badge tone="violet">{type}</Badge>}
    </span>
  );
}

export function Spinner({ label = "Working…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2.5 text-sm text-slate-400">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-brand" />
      {label}
    </div>
  );
}

export function Stat({
  label,
  value,
  accent = false
}: {
  label: string;
  value: ReactNode;
  accent?: boolean;
}) {
  return (
    <Card>
      <div className={`text-2xl font-semibold ${accent ? "text-brand-accent" : "text-slate-900"}`}>{value}</div>
      <div className="mt-1 text-xs uppercase tracking-wide text-slate-500">{label}</div>
    </Card>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-slate-600">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({
  icon = "✦",
  title,
  hint
}: {
  icon?: string;
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-rose-200 bg-white/60 px-8 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-pink-100 to-violet-100 text-2xl text-rose-500 ring-1 ring-inset ring-rose-100">
        {icon}
      </div>
      <div className="mt-4 text-sm font-medium text-slate-800">{title}</div>
      {hint && <div className="mt-1 max-w-sm text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center px-6 py-16">
      <Spinner label={label} />
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

export function statusTone(status: string): BadgeTone {
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
