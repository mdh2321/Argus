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
    <div className="mb-6 flex items-center gap-1 border-b border-border pb-2">
      {links.map((link) => {
        const active = link.exact
          ? pathname === link.href
          : pathname === link.href ||
            (link.href !== links[0]?.href && pathname.startsWith(link.href));
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`px-3 py-1.5 rounded-lg font-mono text-[11px] font-medium tracking-[0.04em] uppercase transition-all duration-150 ${
              active
                ? "text-fg bg-hover"
                : "text-fg-3 hover:text-fg-2 hover:bg-hover"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </div>
  );
}
