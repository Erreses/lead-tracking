"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Overview" },
  { href: "/scrape", label: "Scrape" },
  { href: "/leads", label: "Leads" },
  { href: "/settings", label: "Settings" },
] as const;

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="shrink-0 border-line bg-card lg:w-56 lg:border-r border-b lg:border-b-0">
      <div className="flex items-center gap-2 px-5 py-4 lg:py-5">
        <span
          aria-hidden
          className="grid size-7 place-items-center rounded-md bg-accent text-[13px] font-bold text-accent-ink"
        >
          L
        </span>
        <span className="text-[15px] font-semibold tracking-tight">Lead Tracking</span>
      </div>

      <ul className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible lg:pb-4">
        {LINKS.map((link) => {
          const active =
            link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);

          return (
            <li key={link.href}>
              <Link
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`block whitespace-nowrap rounded-md px-3 py-2 text-sm transition-colors ${
                  active
                    ? "bg-accent-soft font-medium text-accent"
                    : "text-ink-secondary hover:bg-card-muted hover:text-ink"
                }`}
              >
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
