import type { Metadata } from "next";
import Link from "next/link";
import NavLinks from "@/components/NavLinks";
import "./globals.css";

export const metadata: Metadata = {
  title: "Website Change Monitor",
  description: "Website change detection & QA monitoring",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // Browser extensions (e.g. Katalon Recorder, Grammarly) add attributes to <html> before React loads;
    // suppressHydrationWarning ignores those attribute differences on this element only.
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        <header className="bg-linear-to-r from-indigo-700 via-violet-700 to-fuchsia-600 shadow-lg shadow-indigo-200/60">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-8 gap-y-2 px-4 py-3">
            <Link href="/" className="flex items-center gap-2 font-semibold text-white">
              <span className="relative flex h-7 w-7 items-center justify-center rounded-lg bg-white/20 ring-1 ring-white/30">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-300 shadow-[0_0_8px_2px_rgba(110,231,183,0.7)]" />
              </span>
              Website Change Monitor
            </Link>
            <NavLinks />
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
