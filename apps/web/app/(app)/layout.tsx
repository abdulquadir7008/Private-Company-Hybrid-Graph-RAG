"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { Spinner } from "@/components/ui";

const NAV = [
  { href: "/chat", label: "Chat", icon: "💬" },
  { href: "/documents", label: "Documents", icon: "📄" },
  { href: "/graph", label: "Graph", icon: "🕸️" }
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!auth.loading && !auth.token) router.replace("/login");
  }, [auth.loading, auth.token, router]);

  if (auth.loading || !auth.token) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Spinner label="Loading workspace…" />
      </main>
    );
  }

  const links = [...NAV];
  if (auth.isAdmin) links.push({ href: "/admin", label: "Admin", icon: "⚙️" });

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col border-r border-slate-800 bg-ink-950">
        <div className="flex items-center gap-2 px-4 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">Gr</div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-100">Graph RAG</div>
            <div className="truncate text-[11px] text-slate-500">{auth.user?.company?.name ?? auth.user?.email}</div>
          </div>
        </div>
        <nav className="mt-2 flex-1 space-y-1 px-2">
          {links.map((l) => {
            const active = pathname?.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${
                  active ? "bg-slate-800 font-medium text-white" : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
                }`}
              >
                <span className="text-base">{l.icon}</span>
                {l.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-slate-800 p-3">
          <div className="mb-1 flex items-center justify-between">
            <div className="truncate text-xs text-slate-400">{auth.user?.email}</div>
          </div>
          <Link
            href="/change-password"
            className="mb-1 block rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-900 hover:text-slate-300"
          >
            Change password
          </Link>
          <button
            onClick={() => {
              auth.logout();
              router.replace("/login");
            }}
            className="w-full rounded-md bg-slate-800 px-2 py-1.5 text-xs text-slate-300 transition hover:bg-slate-700"
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}