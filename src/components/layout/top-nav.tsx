"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "./theme-provider";
import { Sun, Moon, Search } from "lucide-react";
import { SentinelLogo } from "@/components/ui/sentinel-logo";
import { useProfile } from "@/hooks/use-profile";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/ask", label: "Ask" },
  { href: "/compare", label: "Compare" },
  { href: "/tracker", label: "Tracker" },
  { href: "/digest", label: "Digest" },
  { href: "/library", label: "Library" },
  { href: "/methodology", label: "Methodology" },
  { href: "/settings", label: "Settings" },
];

export function TopNav() {
  const pathname = usePathname();
  const { theme, toggleTheme } = useTheme();

  return (
    <nav className="sticky top-0 z-50 bg-glass backdrop-blur-xl border-b border-border">
      <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
        {/* Left: logo */}
        <Link href="/" className="flex items-center gap-2">
          <SentinelLogo size={24} className="text-fg" />
          <span className="font-mono text-[11px] font-semibold tracking-[0.12em] uppercase text-fg">
            Sentinel
          </span>
        </Link>

        {/* Center: nav links */}
        <div className="flex items-center gap-1">
          {links.map((link) => {
            const active =
              link.href === "/"
                ? pathname === "/"
                : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`nav-dot ${active ? "active" : ""} inline-flex items-center gap-2 px-3 py-1.5 rounded-lg font-mono text-[11px] font-medium tracking-[0.04em] uppercase transition-all duration-150 hover:-translate-y-px ${
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

        {/* Right: profile chip + search + theme toggle */}
        <div className="flex items-center gap-1.5">
          <ProfileChip />
          <button
            onClick={() => {
              const event = new KeyboardEvent("keydown", { key: "k", metaKey: true });
              document.dispatchEvent(event);
            }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-fg-3 hover:text-fg-2 hover:bg-hover transition-all duration-150"
          >
            <Search className="w-[15px] h-[15px]" strokeWidth={1.5} />
            <kbd className="hidden sm:inline-block rounded bg-hover px-1.5 py-0.5 font-mono text-[9px] text-fg-3">&#x2318;K</kbd>
          </button>
          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg text-fg-3 hover:text-fg-2 hover:bg-hover transition-all duration-150 hover:-translate-y-px"
            aria-label="Toggle theme"
          >
            {theme === "dark" ? (
              <Sun className="w-[15px] h-[15px]" strokeWidth={1.5} />
            ) : (
              <Moon className="w-[15px] h-[15px]" strokeWidth={1.5} />
            )}
          </button>
        </div>
      </div>
    </nav>
  );
}

function ProfileChip() {
  const { data } = useProfile();
  const profile = data?.profile;
  const companyName = profile?.companyName;

  if (!companyName) {
    return (
      <Link
        href="/settings"
        className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-mono text-[10px] font-medium tracking-[0.04em] uppercase text-accent hover:bg-hover transition-all duration-150"
        title="Your profile shapes every output — set it up"
      >
        Set up profile →
      </Link>
    );
  }

  return (
    <Link
      href="/settings"
      className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-mono text-[10px] font-medium tracking-[0.04em] uppercase text-fg-3 hover:text-fg-2 hover:bg-hover transition-all duration-150"
      title={`Sentinel is acting for ${companyName}${profile?.role ? ` · ${profile.role}` : ""} — click to edit profile`}
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />
      {companyName}
    </Link>
  );
}
