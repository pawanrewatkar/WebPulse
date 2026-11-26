"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/websites", label: "Websites" },
  { href: "/explorer", label: "Baseline Explorer" },
  { href: "/comparisons", label: "Comparisons" },
  { href: "/jobs", label: "Jobs" },
];

/** Top navigation with the current section highlighted. */
export default function NavLinks() {
  const path = usePathname();
  return (
    <nav className="flex flex-wrap gap-1 text-sm">
      {NAV.map((n) => {
        const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-full px-3 py-1 font-medium transition ${active ? "bg-white text-indigo-700 shadow-sm" : "text-indigo-100 hover:bg-white/15 hover:text-white"}`}
          >
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}
