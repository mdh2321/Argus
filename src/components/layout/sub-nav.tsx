"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface SubNavLink {
  href: string;
  label: string;
  exact?: boolean;
}

export function SubNav({ links }: { links: SubNavLink[] }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Tracker sections" className="mb-6 flex items-center gap-1 border-b border-border pb-2">
      {links.map((link) => {
        const active = link.exact
          ? pathname === link.href
          : pathname === link.href ||
            (link.href !== links[0]?.href && pathname.startsWith(link.href));
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={`inline-flex min-h-11 items-center rounded-lg px-3 text-[14px] font-medium transition-all duration-150 ${
              active
                ? "text-fg shadow-[inset_0_-1px_0_var(--border-hover)]"
                : "text-fg-3 hover:text-fg-2 hover:bg-hover"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
