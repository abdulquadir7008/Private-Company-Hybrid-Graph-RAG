"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { Panel, Badge } from "@/components/ui";
import { LlmSetupModal } from "@/components/LlmSetupModal";

type IconNode = React.ReactNode;

const ChatIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

const GraphIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="6" cy="6" r="2.4" />
    <circle cx="18" cy="6" r="2.4" />
    <circle cx="12" cy="18" r="2.4" />
    <path d="M8.2 6.9l5.6 8.2M15.8 6.9l-5.6 8.2M8.2 6h.2M15.8 6h.2" />
  </svg>
);

const DocsIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6M9 13h6M9 17h6" />
  </svg>
);

const ShieldIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

function Logo() {
  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-pink-500 via-rose-500 to-violet-500 shadow-lg shadow-rose-200">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="5" cy="5" r="2" />
        <circle cx="19" cy="5" r="2" />
        <circle cx="12" cy="19" r="2" />
        <path d="M6 6.8l4.8 9.2M18 6.8l-4.8 9.2M7 5h.1M17 5h.1" />
      </svg>
    </div>
  );
}

function NavItem({
  href,
  label,
  icon,
  active,
  collapsed = false
}: {
  href: string;
  label: string;
  icon: IconNode;
  active: boolean;
  collapsed?: boolean;
}) {
  return (
    <Link
      href={href}
      title={collapsed ? label : undefined}
      aria-label={collapsed ? label : undefined}
      aria-current={active ? "page" : undefined}
      className={`group relative flex items-center rounded-lg py-2.5 text-sm font-medium transition ${collapsed ? "justify-center px-2" : "gap-3 px-3"} ${
        active
          ? "bg-gradient-to-r from-rose-100 to-pink-50 text-rose-600 ring-1 ring-inset ring-rose-200"
          : "text-slate-600 hover:bg-rose-50 hover:text-rose-600"
      }`}
    >
      <span className={active ? "text-rose-500" : "text-slate-400 group-hover:text-rose-500"}>{icon}</span>
      {!collapsed && <span className="truncate">{label}</span>}
      {active && <span className={`${collapsed ? "absolute bottom-1 h-1 w-1" : "ml-auto h-1.5 w-1.5"} rounded-full bg-rose-500 shadow-[0_0_8px_#fb7185]`} />}
    </Link>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pb-1.5 pt-4 text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-400">{children}</div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [showLlmSettings, setShowLlmSettings] = useState(false);
  const [skipSetupForSession, setSkipSetupForSession] = useState(false);

  const showSetup = auth.needsLlmSetup && !skipSetupForSession;
  const dismissLlm = () => {
    setShowLlmSettings(false);
    if (auth.needsLlmSetup) setSkipSetupForSession(true);
  };

  if (auth.loading || !auth.token) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="flex items-center gap-2.5 text-sm text-slate-400">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-indigo-400" />
          Loading workspace…
        </div>
      </main>
    );
  }

  const isActive = (href: string) => pathname?.startsWith(href) ?? false;
  const displayName = auth.user?.name ?? auth.user?.email ?? "User";
  const initials = displayName
    .split(/[\s@]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");

  return (
    <div className="flex h-screen overflow-hidden bg-base bg-app-gradient">
      {/* SIDEBAR */}
      <aside
        className={`relative z-20 hidden shrink-0 flex-col border-r border-rose-100 bg-white/80 shadow-[12px_0_32px_rgba(190,24,93,0.04)] backdrop-blur-md transition-all duration-200 md:flex ${
          collapsed ? "w-16" : "w-60"
        }`}
      >
        {/* Brand */}
        <div className="flex items-center gap-3 px-3 py-4">
          <Logo />
          {!collapsed && (
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold tracking-tight text-slate-900">Graph RAG</div>
              <div className="truncate text-[11px] text-slate-500">Tangible · {auth.user?.company?.name ?? "Private Workspace"}</div>
            </div>
          )}
        </div>

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="mx-3 mb-1 flex items-center justify-center rounded-lg border border-rose-100 bg-rose-50/60 py-1.5 text-slate-400 transition hover:text-rose-600"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`transition-transform duration-200 ${collapsed ? "rotate-180" : ""}`}
          >
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </button>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-2 pb-3">
          {!collapsed && <SectionLabel>Chat</SectionLabel>}
          <NavItem href="/chat" label="Chat" icon={ChatIcon} active={isActive("/chat")} collapsed={collapsed} />

          {!collapsed && <SectionLabel>Knowledge</SectionLabel>}
          <NavItem href="/documents" label="Documents" icon={DocsIcon} active={isActive("/documents")} collapsed={collapsed} />
          <NavItem href="/graph" label="Graph" icon={GraphIcon} active={isActive("/graph")} collapsed={collapsed} />

          {auth.isAdmin && !collapsed && <SectionLabel>Admin</SectionLabel>}
          {auth.isAdmin && <NavItem href="/admin" label="Admin" icon={ShieldIcon} active={isActive("/admin")} collapsed={collapsed} />}
        </nav>

        {/* User block */}
        <div className="border-t border-rose-100 p-3">
          <div className={`flex items-center gap-2.5 ${collapsed ? "justify-center" : ""}`}>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-pink-500 to-rose-500 text-xs font-bold text-white shadow-md shadow-rose-200">
              {initials || "U"}
            </div>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium text-slate-800">{displayName}</div>
                <div className="truncate text-[10px] text-slate-500">{auth.user?.department ?? auth.user?.email}</div>
              </div>
            )}
          </div>
          {!collapsed && (
            <div className="mt-2 space-y-0.5">
              <button
                onClick={() => setShowLlmSettings(true)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-slate-500 transition hover:bg-rose-500/10 hover:text-rose-300"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                </svg>
                Manage API provider
                {auth.needsLlmSetup && <Badge tone="amber">setup</Badge>}
              </button>
              <Link
                href="/change-password"
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-slate-500 transition hover:bg-white/5 hover:text-slate-200"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                Change password
              </Link>
              <button
                onClick={() => {
                  auth.logout();
                  router.replace("/login");
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-slate-500 transition hover:bg-rose-500/10 hover:text-rose-300"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
                </svg>
                Sign out
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* MAIN */}
      <main className="relative z-10 flex min-w-0 flex-1 flex-col pb-16 md:pb-0">
        {/* Top bar */}
        <header className="flex h-14 shrink-0 items-center border-b border-rose-100 bg-white/70 px-4 backdrop-blur-md md:px-5">
          <div className="flex items-center gap-2 text-sm">
            <div className="md:hidden"><Logo /></div>
            <span className="font-semibold tracking-tight text-slate-900">
              {isActive("/chat") ? "Chat" : isActive("/documents") ? "Documents" : isActive("/graph") ? "Graph Explorer" : isActive("/admin") ? "Admin" : "Workspace"}
            </span>
            <span className="hidden text-slate-600 sm:inline">/</span>
            <span className="hidden text-slate-500 sm:inline">Authorized knowledge graph</span>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-600">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399]" />
              ACL enforced
            </span>
            {auth.isAdmin && (
              <span className="inline-flex items-center rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-medium text-violet-600 ring-1 ring-inset ring-violet-200">
                Admin
              </span>
            )}
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </main>

      <nav className={`fixed inset-x-0 bottom-0 z-30 grid h-16 border-t border-rose-100 bg-white/95 px-2 backdrop-blur-xl md:hidden ${auth.isAdmin ? "grid-cols-4" : "grid-cols-3"}`}>
        <MobileNavItem href="/chat" label="Chat" icon={ChatIcon} active={isActive("/chat")} />
        <MobileNavItem href="/documents" label="Documents" icon={DocsIcon} active={isActive("/documents")} />
        <MobileNavItem href="/graph" label="Graph" icon={GraphIcon} active={isActive("/graph")} />
        {auth.isAdmin && <MobileNavItem href="/admin" label="Admin" icon={ShieldIcon} active={isActive("/admin")} />}
      </nav>

      {/* LLM / API provider setup — shown after first login when none is active,
          and reopenable from the sidebar ("Manage API"). */}
      {(showSetup || showLlmSettings) && <LlmSetupModal onDismiss={dismissLlm} />}

      {/* Full-screen overlay shown while documents are re-indexed after a
          provider / embedding-model change. */}
      {auth.reindexing && (
        <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-4 bg-slate-900/70 backdrop-blur-sm">
          <span className="h-10 w-10 animate-spin rounded-full border-4 border-rose-300 border-t-rose-600" />
          <div className="text-center">
            <p className="text-sm font-semibold text-white">Reindexing your documents…</p>
            <p className="mt-1 text-xs text-slate-300">
              We are re-embedding your knowledge graph with the new AI provider. This may take a moment.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function MobileNavItem({ href, label, icon, active }: { href: string; label: string; icon: IconNode; active: boolean }) {
  return (
    <Link
      href={href}
      className={`flex flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-medium transition ${
        active ? "text-rose-600" : "text-slate-500"
      }`}
    >
      <span className={`flex h-7 w-10 items-center justify-center rounded-lg ${active ? "bg-rose-100" : ""}`}>{icon}</span>
      {label}
    </Link>
  );
}
