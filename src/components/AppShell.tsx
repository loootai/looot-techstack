"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, BookOpen, ExternalLink, Menu, Moon, PanelLeftClose, PanelLeftOpen, Sun, X } from "lucide-react";
import { SHELL, type ShellNavItem } from "./shell.config";

/** Spend shown in the sidebar. Strings are pre-formatted by the layout so this file stays app-agnostic. */
export type ShellSpend = { title: string; spent: string; cap: string | null; ratio: number; note?: string };

const COLLAPSE_KEY = "looot.sidebar";
const COLLAPSE_EVENT = "looot-sidebar-change";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "collapsed";
  } catch {
    return false;
  }
}

/** True when the 64px icon rail is on. Falls back to expanded when localStorage is unavailable. */
function useCollapsed(): [boolean, (next: boolean) => void] {
  const value = React.useSyncExternalStore(
    (cb) => {
      window.addEventListener(COLLAPSE_EVENT, cb);
      window.addEventListener("storage", cb);
      return () => {
        window.removeEventListener(COLLAPSE_EVENT, cb);
        window.removeEventListener("storage", cb);
      };
    },
    readCollapsed,
    () => false,
  );
  const set = React.useCallback((next: boolean) => {
    try {
      localStorage.setItem(COLLAPSE_KEY, next ? "collapsed" : "expanded");
    } catch {}
    window.dispatchEvent(new Event(COLLAPSE_EVENT));
  }, []);
  return [value, set];
}

function useIsDark(): boolean {
  return React.useSyncExternalStore(
    (cb) => {
      window.addEventListener("themechange", cb);
      return () => window.removeEventListener("themechange", cb);
    },
    () => document.documentElement.classList.contains("dark"),
    () => false,
  );
}

function toggleTheme(dark: boolean) {
  const next = dark ? "light" : "dark";
  document.documentElement.classList.toggle("dark", next === "dark");
  try {
    localStorage.setItem("theme", next);
  } catch {}
  window.dispatchEvent(new Event("themechange"));
}

const isActive = (path: string, item: ShellNavItem) => {
  const hit = (p: string) => (p === "/" ? path === "/" : path === p || path.startsWith(`${p}/`));
  return hit(item.href) || (item.match ?? []).some(hit);
};

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** App frame shared by every looot app: fixed sidebar from 1024px, drawer below it. */
export function AppShell({ demo, spend, signOut = false, children }: { demo: boolean; spend?: ShellSpend | null; /** Show a Sign out button. True when admin sign-in is on. */ signOut?: boolean; children: React.ReactNode }) {
  const path = usePathname();
  const [collapsed, setCollapsed] = useCollapsed();
  const [open, setOpen] = React.useState(false);
  const [lastPath, setLastPath] = React.useState(path);
  const menuRef = React.useRef<HTMLButtonElement>(null);
  const drawerRef = React.useRef<HTMLDivElement>(null);

  if (path !== lastPath) {
    setLastPath(path);
    setOpen(false);
  }

  const current = SHELL.nav.find((n) => isActive(path, n));
  const title = current?.title ?? current?.label ?? SHELL.name;

  React.useEffect(() => {
    if (!open) return;
    const drawer = drawerRef.current;
    const menu = menuRef.current;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    drawer?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (e.key !== "Tab" || !drawer) return;
      const items = Array.from(drawer.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (!drawer.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      menu?.focus();
    };
  }, [open]);

  return (
    <div className="min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[80] focus:rounded-control focus:bg-brand focus:px-3 focus:py-2 focus:text-13 focus:text-brand-ink">
        Skip to content
      </a>

      <aside className={`fixed inset-y-0 left-0 z-30 hidden flex-col bg-[var(--sidebar)] text-[var(--sidebar-fg)] transition-[width] duration-150 lg:flex ${collapsed ? "w-16" : "w-60"}`}>
        <SidebarBody collapsed={collapsed} label="Main" demo={demo} signOut={signOut} spend={spend} path={path} onToggle={() => setCollapsed(!collapsed)} />
      </aside>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} aria-hidden="true" />
          <div ref={drawerRef} role="dialog" aria-modal="true" aria-label={`${SHELL.name} menu`} className="absolute inset-y-0 left-0 flex w-[min(20rem,85vw)] flex-col bg-[var(--sidebar)] text-[var(--sidebar-fg)] shadow-pop">
            <SidebarBody collapsed={false} label="Main menu" demo={demo} signOut={signOut} spend={spend} path={path} onClose={() => setOpen(false)} />
          </div>
        </div>
      )}

      <div className={`flex min-h-dvh min-w-0 flex-col transition-[padding] duration-150 ${collapsed ? "lg:pl-16" : "lg:pl-60"}`}>
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b border-line bg-page/95 px-3 backdrop-blur-sm sm:px-6 lg:h-12">
          <button ref={menuRef} type="button" onClick={() => setOpen(true)} aria-label="Open menu" aria-haspopup="dialog" aria-expanded={open} className="grid size-10 shrink-0 place-items-center rounded-control text-ink hover:bg-hover lg:hidden">
            <Menu className="size-5" />
          </button>
          <Image src="/brand/looot-mark.svg" alt="" width={22} height={22} className="shrink-0 dark:hidden lg:hidden" />
          <Image src="/brand/looot-mark-white.svg" alt="" width={22} height={22} className="hidden shrink-0 dark:block dark:lg:hidden" />
          <p className="min-w-0 truncate text-14 font-medium text-ink">{title}</p>
          {demo && <span className="shrink-0 rounded-control border border-line-strong bg-amber-soft px-1.5 py-0.5 text-11 font-medium text-amber lg:hidden">Demo</span>}
          {current?.action && (
            <Link href={current.action.href} className="ml-auto inline-flex h-10 shrink-0 items-center rounded-control bg-brand px-3 text-13 font-medium text-brand-ink hover:opacity-90 lg:h-8">
              {current.action.label}
            </Link>
          )}
        </header>
        <main id="main" className="mx-auto w-full max-w-[1200px] flex-1 px-4 pb-16 pt-6 sm:px-6">
          {children}
        </main>
      </div>
    </div>
  );
}

function SidebarBody({ collapsed, label, demo, signOut, spend, path, onToggle, onClose }: { collapsed: boolean; label: string; demo: boolean; signOut: boolean; spend?: ShellSpend | null; path: string; onToggle?: () => void; onClose?: () => void }) {
  const dark = useIsDark();
  const groups: { name: string | null; items: ShellNavItem[] }[] = [];
  const grouped = SHELL.nav.length > 6;
  for (const item of SHELL.nav) {
    const name = grouped ? (item.group ?? "More") : null;
    const last = groups[groups.length - 1];
    if (last && last.name === name) last.items.push(item);
    else groups.push({ name, items: [item] });
  }
  const ring = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7fe0b8]";
  const small = `flex h-10 items-center gap-2.5 rounded-control px-2.5 text-13 text-[var(--sidebar-muted)] hover:bg-white/5 hover:text-[var(--sidebar-fg)] lg:h-9 ${ring} ${collapsed ? "justify-center px-0" : ""}`;
  const pct = spend ? Math.max(0, Math.min(1, spend.ratio)) : 0;
  return (
    <>
      <div className={`flex h-14 shrink-0 items-center gap-2 lg:h-12 ${collapsed ? "justify-center px-0" : "px-4"}`}>
        <Link href="/" onClick={onClose} aria-label={`${SHELL.name}, home`} className={`flex min-w-0 items-center gap-2 rounded-control ${ring}`}>
          <Image src="/brand/looot-mark-white.svg" alt="" width={26} height={26} className="shrink-0" priority />
          {!collapsed && <span className="truncate text-[15px] font-semibold tracking-tight">{SHELL.name}</span>}
        </Link>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close menu" className={`ml-auto grid size-10 shrink-0 place-items-center rounded-control text-[var(--sidebar-muted)] hover:bg-white/5 hover:text-[var(--sidebar-fg)] ${ring}`}>
            <X className="size-5" />
          </button>
        )}
      </div>

      <nav aria-label={label} className="flex-1 overflow-y-auto px-2 pb-2 pt-1">
        {groups.map((g, i) => (
          <div key={g.name ?? "all"} className={i > 0 ? "mt-3" : ""}>
            {g.name && !collapsed && <p className="px-2.5 pb-1 pt-1 text-11 font-medium uppercase tracking-wider text-[var(--sidebar-muted)]">{g.name}</p>}
            {g.name && collapsed && i > 0 && <div className="mx-2 mb-2 h-px bg-white/10" />}
            <ul className="grid gap-0.5">
              {g.items.map((n) => {
                const on = isActive(path, n);
                return (
                  <li key={n.href}>
                    <Link
                      href={n.href}
                      onClick={onClose}
                      aria-current={on ? "page" : undefined}
                      title={collapsed ? n.label : undefined}
                      className={`relative flex h-10 items-center gap-2.5 rounded-control px-2.5 text-13 font-medium lg:h-9 ${ring} ${collapsed ? "justify-center px-0" : ""} ${on ? "bg-[var(--sidebar-active)] text-[var(--sidebar-fg)]" : "text-[var(--sidebar-muted)] hover:bg-white/5 hover:text-[var(--sidebar-fg)]"}`}
                    >
                      {on && <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-[#12a06a]" aria-hidden="true" />}
                      <n.icon className="size-4 shrink-0" strokeWidth={1.5} />
                      {collapsed ? <span className="sr-only">{n.label}</span> : <span className="truncate">{n.label}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="grid gap-1 border-t border-white/10 p-2">
        {spend && !collapsed && (
          <div className="mb-1 rounded-control bg-white/5 p-2.5" role="group" aria-label={spend.title}>
            <p className="text-11 text-[var(--sidebar-muted)]">{spend.title}</p>
            <p className="num mt-0.5 text-13 font-medium">
              {spend.spent}
              {spend.cap && <span className="font-normal text-[var(--sidebar-muted)]"> of {spend.cap}</span>}
            </p>
            {spend.cap && (
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-label={`${spend.title} against the cap`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct * 100)}>
                <div className="h-full rounded-full bg-[#12a06a]" style={{ width: `${pct * 100}%` }} />
              </div>
            )}
            {spend.note && <p className="mt-1.5 text-11 leading-4 text-[var(--sidebar-muted)]">{spend.note}</p>}
          </div>
        )}
        {spend && collapsed && (
          <div className="mx-auto mb-1 grid w-10 gap-1 text-center" title={`${spend.title}: ${spend.spent}${spend.cap ? ` of ${spend.cap}` : ""}`} role="group" aria-label={`${spend.title}: ${spend.spent}${spend.cap ? ` of ${spend.cap}` : ""}`}>
            <span className="num text-11 font-medium" aria-hidden="true">{spend.spent}</span>
            {spend.cap && (
              <div className="h-1 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
                <div className="h-full rounded-full bg-[#12a06a]" style={{ width: `${pct * 100}%` }} />
              </div>
            )}
          </div>
        )}
        {demo && (
          <span className={`inline-flex h-6 items-center justify-center rounded-control border border-amber/40 bg-amber-soft px-2 text-11 font-medium text-amber ${collapsed ? "mx-auto w-10 px-0" : "mr-auto"}`} title="Sample data. No looot calls, no charge.">
            {collapsed ? "Demo" : "Demo, no sign-in"}
          </span>
        )}
        <a href={SHELL.docsUrl} target="_blank" rel="noreferrer" className={small} title={collapsed ? "Docs" : undefined}>
          <BookOpen className="size-4 shrink-0" strokeWidth={1.5} />
          {collapsed ? <span className="sr-only">Docs</span> : <span>Docs</span>}
          {!collapsed && <ExternalLink className="ml-auto size-3 opacity-60" />}
        </a>
        <a href={SHELL.repoUrl} target="_blank" rel="noreferrer" className={small} title={collapsed ? "GitHub" : undefined}>
          <GithubMark />
          {collapsed ? <span className="sr-only">GitHub</span> : <span>GitHub</span>}
          {!collapsed && <ExternalLink className="ml-auto size-3 opacity-60" />}
        </a>
        {signOut && (
          <form method="post" action="/api/auth/logout">
            <button type="submit" className={`${small} w-full`} title={collapsed ? "Sign out" : undefined}>
              <LogOut className="size-4 shrink-0" strokeWidth={1.5} />
              {collapsed ? <span className="sr-only">Sign out</span> : <span>Sign out</span>}
            </button>
          </form>
        )}
        <button type="button" onClick={() => toggleTheme(dark)} aria-label={dark ? "Switch to light theme" : "Switch to dark theme"} title={collapsed ? (dark ? "Light theme" : "Dark theme") : undefined} className={`${small} w-full`}>
          {dark ? <Sun className="size-4 shrink-0" strokeWidth={1.5} /> : <Moon className="size-4 shrink-0" strokeWidth={1.5} />}
          {!collapsed && <span>{dark ? "Light theme" : "Dark theme"}</span>}
        </button>
        {onToggle && (
          <button type="button" onClick={onToggle} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!collapsed} title={collapsed ? "Expand sidebar" : undefined} className={`${small} w-full`}>
            {collapsed ? <PanelLeftOpen className="size-4 shrink-0" strokeWidth={1.5} /> : <PanelLeftClose className="size-4 shrink-0" strokeWidth={1.5} />}
            {!collapsed && <span>Collapse</span>}
          </button>
        )}
      </div>
    </>
  );
}

/** The GitHub mark. lucide-react no longer ships brand icons, so it is inline. */
function GithubMark() {
  return (
    <svg viewBox="0 0 16 16" className="size-4 shrink-0" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.5 7.5 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}
