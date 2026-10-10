"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Layers, Moon, Search, Sun, Table2 } from "lucide-react";
import { Badge } from "@/components/ui/misc";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Lookup", icon: Search },
  { href: "/bulk", label: "Bulk table", icon: Table2 },
  { href: "/find", label: "Find companies", icon: Layers },
];

export function Shell({ demo, children }: { demo: boolean; children: React.ReactNode }) {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  const toggle = () => {
    const dark = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", dark);
    try {
      localStorage.setItem("theme", dark ? "dark" : "light");
    } catch {}
  };
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-line bg-page/95 backdrop-blur">
        <div className="mx-auto flex h-12 max-w-6xl items-center gap-4 px-4 md:px-6">
          <Link href="/" className="flex items-center gap-2 font-semibold text-ink">
            <Image src="/brand/looot-mark.svg" alt="" width={20} height={20} className="dark:hidden" />
            <Image src="/brand/looot-mark-white.svg" alt="" width={20} height={20} className="hidden dark:block" />
            looot-techstack
          </Link>
          <nav aria-label="Main" className="flex flex-1 items-center gap-1 overflow-x-auto">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} aria-current={active(n.href) ? "page" : undefined} className={cn("flex h-8 items-center gap-1.5 whitespace-nowrap rounded-control px-2.5 text-13 text-mute hover:bg-hover hover:text-ink", active(n.href) && "bg-brand-soft text-link")}>
                <n.icon className="size-4" />
                {n.label}
              </Link>
            ))}
          </nav>
          {demo && <Badge tone="amber">Demo data</Badge>}
          <button type="button" aria-label="Toggle dark mode" onClick={toggle} className="flex size-8 items-center justify-center rounded-control text-mute hover:bg-hover hover:text-ink">
            <Moon className="size-4 dark:hidden" />
            <Sun className="hidden size-4 dark:block" />
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 md:px-6">{children}</main>
    </div>
  );
}
