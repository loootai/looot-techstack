import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { AppShell } from "@/components/AppShell";
import { getSpend } from "@/lib/app";
import { currentCsrf, requireAdminPage } from "@/lib/auth/guard";
import { isPublicPath } from "@/lib/auth/routes";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "looot-techstack", template: "%s · looot-techstack" },
  description: "Open-source technology lookup for websites: technologies by category, providers side by side. Built on looot.",
  icons: { icon: "/brand/looot-mark.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F7F8F5" },
    { media: "(prefers-color-scheme: dark)", color: "#0A1512" },
  ],
};

const themeScript = `(function(){try{var q=new URLSearchParams(location.search).get("theme");var t=q||localStorage.getItem("theme")||"system";var d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}})()`;

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const path = (await headers()).get("x-techstack-path") ?? "";
  // Public routes (the sign-in page) render with no stored data and no admin navigation.
  if (path !== "" && isPublicPath(path)) {
    return (
      <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
        <head>
          <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        </head>
        <body className="min-h-dvh bg-page text-ink">
          <main className="mx-auto min-h-dvh max-w-xl px-4 py-10">{children}</main>
        </body>
      </html>
    );
  }
  const gate = await requireAdminPage();
  const csrf = await currentCsrf();
  const spend = await getSpend();
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <meta name="techstack-csrf" content={csrf} />
      </head>
      <body className="min-h-dvh bg-page text-ink">
        <AppShell demo={gate.policy.mode === "open-demo"} signOut={gate.policy.mode === "login"} spend={spend}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}
