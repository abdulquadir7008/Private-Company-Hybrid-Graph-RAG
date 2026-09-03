"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { LlmSetupModal } from "@/components/LlmSetupModal";
import SearchModal from "@/components/SearchModal";

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

const EntitiesIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="m12 3 7 4v10l-7 4-7-4V7zM5 7l7 4 7-4m-7 4v10" />
  </svg>
);

const AnalyticsIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 20V10m5 10V4m5 16v-7m5 7V7" />
    <path d="M2 20h20" />
  </svg>
);

const AuditLogsIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="M9 12h6m-6 3h4" />
  </svg>
);

function Logo() {
  return (
    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-pink-500 via-rose-500 to-fuchsia-600 shadow-lg shadow-rose-200">
      <svg width="27" height="27" viewBox="0 0 48 48" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="m14 15 10-6 10 6m-20 0-2 14 12 10 12-10-2-14m-20 0 10 9 10-9m-22 14 12-5 12 5M24 24v15" />
        {[[14,15],[34,15],[12,29],[36,29],[24,9],[24,39]].map(([cx, cy]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="3" fill="#fff" stroke="none" />)}
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
  const [profileOpen, setProfileOpen] = useState(false);
  const [skipSetupForSession, setSkipSetupForSession] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const showSetup = auth.needsLlmSetup && !skipSetupForSession;
  const dismissLlm = () => {
    setShowLlmSettings(false);
    if (auth.needsLlmSetup) setSkipSetupForSession(true);
  };

  const toggleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // Fullscreen API not supported or blocked
    }
  }, []);

  const handleFullscreenChange = useCallback(() => {
    setIsFullscreen(!!document.fullscreenElement);
  }, []);

  const handleCmdK = useCallback((event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      setSearchOpen((open) => !open);
    }
  }, []);

  const sizeChange = useCallback(() => {
    handleFullscreenChange();
  }, [handleFullscreenChange]);

  useEffect(() => {
    document.addEventListener("fullscreenchange", sizeChange);
    document.addEventListener("keydown", handleCmdK);
    return () => {
      document.removeEventListener("fullscreenchange", sizeChange);
      document.removeEventListener("keydown", handleCmdK);
    };
  }, [sizeChange, handleCmdK]);

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
      {!isActive("/chat") && <aside
        className={`relative z-20 hidden shrink-0 flex-col border-r border-rose-100 bg-white/80 shadow-[12px_0_32px_rgba(190,24,93,0.04)] backdrop-blur-md transition-all duration-200 md:flex ${
          collapsed ? "w-16" : "w-60"
        }`}
      >
        {/* Brand */}
        <div className="flex items-center gap-3 px-3 py-4">
          <Logo />
          {!collapsed && (
          <div className="min-w-0">
              <div className="truncate text-[18px] font-bold tracking-tight text-slate-900">Graph RAG Assistant</div>
              <div className="truncate text-[11px] text-rose-500">Tangible · Trusted · Intelligent</div>
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
          <NavItem href="/entities" label="Entities" icon={EntitiesIcon} active={isActive("/entities")} collapsed={collapsed} />
          <NavItem href="/analytics" label="Analytics" icon={AnalyticsIcon} active={isActive("/analytics")} collapsed={collapsed} />
          <NavItem href="/audit-logs" label="Audit logs" icon={AuditLogsIcon} active={isActive("/audit-logs")} collapsed={collapsed} />

          {auth.isAdmin && !collapsed && <SectionLabel>Admin</SectionLabel>}
          {auth.isAdmin && <NavItem href="/admin" label="Admin" icon={ShieldIcon} active={isActive("/admin")} collapsed={collapsed} />}
        </nav>

      </aside>}

      {/* MAIN */}
      <main className="relative z-30 flex min-w-0 flex-1 flex-col pb-16 md:pb-0">
        {/* Top bar */}
        <header className="relative z-[60] flex h-[82px] shrink-0 items-center border-b border-rose-100 bg-white/75 px-4 backdrop-blur-md md:px-5 lg:px-7">
          {isActive("/chat") && <div className="hidden items-center gap-3 pr-8 xl:flex"><Logo /><div><div className="text-base font-bold tracking-tight text-slate-900">Graph RAG Assistant</div><div className="text-[10px] text-rose-500">Tangible · Trusted · Intelligent</div></div></div>}
          <div className="flex items-center gap-2 text-sm lg:hidden">
            <div className="md:hidden"><Logo /></div>
            <span className="font-semibold tracking-tight text-slate-900">
              {isActive("/chat") ? "Chat" : isActive("/documents") ? "Documents" : isActive("/graph") ? "Graph Explorer" : isActive("/admin") ? "Admin" : "Workspace"}
            </span>
            <span className="hidden text-slate-600 sm:inline">/</span>
            <span className="hidden text-slate-500 sm:inline">Authorized knowledge graph</span>
          </div>
          <button className="hidden rounded-lg border border-rose-100 bg-white px-3 py-2 text-left shadow-sm lg:block"><span className="block text-[10px] text-slate-500">Workspace</span><span className="flex items-center gap-2 text-sm font-medium text-slate-800">♙ {auth.user?.company?.name ?? "Private Workspace"} <span className="ml-7 text-slate-400">⌄</span></span></button>
          <button onClick={() => setSearchOpen(true)} className="mx-auto hidden w-full max-w-md lg:block"><div className="flex items-center gap-3 rounded-xl border border-rose-100 bg-white px-4 py-3 text-sm text-slate-400 shadow-sm transition hover:border-rose-200 hover:text-slate-500"><span className="text-lg text-slate-600">⌕</span> Search documents, entities, policies... <span className="ml-auto rounded bg-slate-100 px-1.5 py-0.5 text-[10px]">⌘K</span></div></button>
          <div className="ml-auto flex items-center gap-3">
            {!isActive("/chat") && <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-600">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399]" />
              ACL enforced
            </span>}
            {auth.isAdmin && (
              <span className="inline-flex items-center rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-medium text-violet-600 ring-1 ring-inset ring-violet-200">
                Admin
              </span>
            )}
            <button aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"} onClick={toggleFullscreen} title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"} className="hidden h-10 w-10 items-center justify-center rounded-xl border border-rose-100 bg-white text-slate-500 transition hover:text-rose-500 lg:flex"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{isFullscreen ? <><path d="M9 21H5a2 2 0 0 1-2-2v-4m18 0v4a2 2 0 0 1-2 2h-4M9 3H5a2 2 0 0 0-2 2v4m18 0V5a2 2 0 0 0-2-2h-4" /></> : <><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></>}</svg></button>
            <div className="relative z-[70] hidden lg:block"><button onClick={() => setProfileOpen((open) => !open)} aria-expanded={profileOpen} className="flex items-center gap-2 rounded-xl px-2 py-1.5 text-left transition hover:bg-rose-50"><div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-fuchsia-500 to-violet-500 text-xs font-bold text-white">{initials || "U"}</div><div className="text-xs"><div className="font-semibold text-slate-900">{displayName}</div><div className="text-slate-500">{auth.user?.department ?? "Member"}</div></div><span className="text-slate-400">⌄</span></button>{profileOpen && <div className="absolute right-0 top-[54px] z-[100] w-60 overflow-hidden rounded-2xl border border-rose-100 bg-white p-2 shadow-[0_18px_48px_rgba(190,24,93,.16)]"><div className="border-b border-rose-100 px-3 py-2"><div className="text-xs font-semibold text-slate-900">Workspace account</div><div className="mt-0.5 truncate text-[11px] text-slate-500">{auth.user?.company?.name ?? "Private Workspace"}</div></div><button onClick={() => { setShowLlmSettings(true); setProfileOpen(false); }} className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-rose-50 hover:text-rose-600">✦ Manage AI Provider</button><button onClick={() => setProfileOpen(false)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-rose-50 hover:text-rose-600">⚙ Settings</button><button onClick={() => { router.push("/change-password"); setProfileOpen(false); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-rose-50 hover:text-rose-600">▣ Reset password</button>{auth.isAdmin && <button onClick={() => { router.push("/admin"); setProfileOpen(false); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-rose-50 hover:text-rose-600">◈ Admin</button>}<div className="mt-1 border-t border-rose-100 pt-1"><button onClick={() => { auth.logout(); router.replace("/login"); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm text-slate-500 hover:bg-rose-50 hover:text-rose-600">⇥ Sign out</button></div></div>}</div>
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

      {/* Global search modal - opens via click or Cmd/Ctrl+K */}
      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />

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
