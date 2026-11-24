import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Website Change Monitor",
  description: "Website change detection & QA monitoring",
};

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/websites", label: "Websites" },
  { href: "/explorer", label: "Baseline Explorer" },
  { href: "/comparisons", label: "Comparisons" },
  { href: "/jobs", label: "Jobs" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <header className="border-b border-gray-200 bg-white">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
            <Link href="/" className="font-semibold text-gray-900">
              <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full bg-blue-600" />
              Website Change Monitor
            </Link>
            <nav className="flex flex-wrap gap-1 text-sm">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="rounded px-2.5 py-1 text-gray-600 hover:bg-gray-100 hover:text-gray-900">
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
