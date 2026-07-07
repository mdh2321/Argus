"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useTheme } from "./theme-provider";
import { Sun, Moon, Search, Plus, ChevronDown, Menu, X } from "lucide-react";
import { SentinelLogo } from "@/components/ui/sentinel-logo";
import { IconButton } from "@/components/ui/button";
import { useProfile } from "@/hooks/use-profile";
import { openCaptureModal } from "@/components/shared/capture-modal";
import { ActivityPopover } from "@/components/layout/activity-popover";

// The five daily-workflow destinations stay visible; reference surfaces fold
// into "More" on desktop and the drawer on mobile.
const primaryLinks = [
  { href: "/", label: "Dashboard" },
  { href: "/ask", label: "Ask" },
  { href: "/tracker", label: "Tracker" },
  { href: "/digest", label: "Digest" },
  { href: "/library", label: "Library" },
];

const secondaryLinks = [
  { href: "/compare", label: "Compare" },
  { href: "/methodology", label: "Methodology" },
  { href: "/settings", label: "Settings" },
];

const allLinks = [...primaryLinks, ...secondaryLinks];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function TopNav() {
  const pathname = usePathname();
  const { theme, toggleTheme } = useTheme();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const secondaryActive = secondaryLinks.some((l) => isActive(pathname, l.href));

  return (
    <nav className="sticky top-0 z-50 bg-glass backdrop-blur-xl border-b border-border">
      <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between gap-3">
        {/* Left: logo */}
        <Link href="/" className="flex items-center gap-2 flex-shrink-0">
          <SentinelLogo size={24} className="text-fg" />
          <span className="font-mono text-[11px] font-semibold tracking-[0.12em] uppercase text-fg">
            Sentinel
          </span>
        </Link>

        {/* Center: primary links + More (desktop only) */}
        <div className="hidden md:flex items-center gap-1">
          {primaryLinks.map((link) => {
            const active = isActive(pathname, link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
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

          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg font-mono text-[11px] font-medium tracking-[0.04em] uppercase transition-all duration-150 hover:-translate-y-px data-[state=open]:bg-hover ${
                  secondaryActive
                    ? "text-fg bg-hover"
                    : "text-fg-3 hover:text-fg-2 hover:bg-hover"
                }`}
              >
                More
                <ChevronDown className="w-3 h-3" strokeWidth={2} />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={8}
                collisionPadding={16}
                className="z-50 min-w-[180px] rounded-xl border border-border bg-surface p-1 shadow-xl"
              >
                {secondaryLinks.map((link) => (
                  <DropdownMenu.Item key={link.href} asChild>
                    <Link
                      href={link.href}
                      className={`flex items-center px-2.5 py-1.5 rounded-md font-mono text-[11px] tracking-[0.04em] uppercase cursor-pointer outline-none data-[highlighted]:bg-hover data-[highlighted]:text-fg ${
                        isActive(pathname, link.href) ? "text-fg" : "text-fg-2"
                      }`}
                    >
                      {link.label}
                    </Link>
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>

        {/* Right: profile + actions */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <ProfileChip />
          <ActivityPopover />
          <IconButton
            onClick={openCaptureModal}
            aria-label="Capture a URL or text to the tracker"
            title="Capture a URL or text to the tracker"
          >
            <Plus className="w-[15px] h-[15px]" strokeWidth={1.5} />
          </IconButton>
          <IconButton
            onClick={() => {
              const event = new KeyboardEvent("keydown", { key: "k", metaKey: true });
              document.dispatchEvent(event);
            }}
            aria-label="Search (Command-K)"
            className="gap-1.5"
          >
            <Search className="w-[15px] h-[15px]" strokeWidth={1.5} />
            <kbd className="hidden sm:inline-block rounded bg-hover px-1.5 py-0.5 font-mono text-[9px] text-fg-3">&#x2318;K</kbd>
          </IconButton>
          <IconButton
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            className="hover:-translate-y-px"
          >
            {theme === "dark" ? (
              <Sun className="w-[15px] h-[15px]" strokeWidth={1.5} />
            ) : (
              <Moon className="w-[15px] h-[15px]" strokeWidth={1.5} />
            )}
          </IconButton>

          {/* Mobile menu toggle */}
          <IconButton
            onClick={() => setDrawerOpen((o) => !o)}
            aria-label={drawerOpen ? "Close menu" : "Open menu"}
            aria-expanded={drawerOpen}
            className="md:hidden"
          >
            {drawerOpen ? (
              <X className="w-[17px] h-[17px]" strokeWidth={1.5} />
            ) : (
              <Menu className="w-[17px] h-[17px]" strokeWidth={1.5} />
            )}
          </IconButton>
        </div>
      </div>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="md:hidden border-t border-border bg-glass backdrop-blur-xl anim-enter">
          <div className="max-w-5xl mx-auto px-4 py-3 grid grid-cols-2 gap-1.5">
            {allLinks.map((link) => {
              const active = isActive(pathname, link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setDrawerOpen(false)}
                  aria-current={active ? "page" : undefined}
                  className={`px-3 py-2.5 rounded-lg font-mono text-[12px] font-medium tracking-[0.04em] uppercase transition-colors ${
                    active
                      ? "text-fg bg-hover"
                      : "text-fg-2 hover:text-fg hover:bg-hover"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>
        </div>
      )}
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
        className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-mono text-[10px] font-medium tracking-[0.04em] uppercase text-accent-text hover:bg-hover transition-all duration-150"
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
