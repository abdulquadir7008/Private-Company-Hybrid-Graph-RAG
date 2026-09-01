import type { ReactNode } from "react";

export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-app-gradient px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-pink-500 via-rose-500 to-violet-500 text-xl font-bold text-white shadow-lg shadow-rose-200">
            ✦
          </div>
          <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
        </div>
        <div className="rounded-2xl border border-rose-100 bg-white/90 p-6 shadow-[0_20px_60px_rgba(190,24,93,0.10)] backdrop-blur-sm">{children}</div>
      </div>
    </main>
  );
}
