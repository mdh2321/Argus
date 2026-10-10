"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useTheme } from "./theme-provider";
import { Sun, Moon, Search, Plus, ChevronDown, Menu, X } from "lucide-react";
import { ArgusLogo } from "@/components/ui/argus-logo";
import { IconButton } from "@/components/ui/button";
import { useProfile } from "@/hooks/use-profile";
import { useDigestIssues, type DigestStory } from "@/hooks/use-digest";
import { getFlag } from "@/lib/digest-utils";
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
  { href: "/matters", label: "Matters" },
  { href: "/compare", label: "Compare" },
  { href: "/automations", label: "Automations" },
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
  const trackerLibrary = pathname === "/tracker";

  const secondaryActive = secondaryLinks.some((l) => isActive(pathname, l.href));

  return (
    <nav aria-label="Primary navigation" className="sticky top-0 z-50 bg-glass backdrop-blur-xl border-b border-border">
      <div className={`${trackerLibrary ? "max-w-[1440px]" : "max-w-5xl"} mx-auto px-4 sm:px-6 min-h-16 flex items-center justify-between gap-3`}>
        {/* Left: logo */}
        <Link href="/" className="flex min-h-11 items-center gap-2 flex-shrink-0" aria-label="Argus home">
          <ArgusLogo size={24} className="text-fg" />
          <span className="font-mono text-[11px] font-semibold tracking-[0.12em] uppercase text-fg">
            Argus
          </span>
        </Link>

        {/* Center: primary links + More (desktop only) */}
        <div className="hidden md:flex items-center gap-1">
          {primaryLinks.map((link) => (
            <NavPrimaryLink key={link.href} link={link} active={isActive(pathname, link.href)} />
          ))}

          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                className={`inline-flex min-h-11 items-center gap-1 px-3 rounded-lg text-[14px] font-medium transition-all duration-150 data-[state=open]:bg-hover ${
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
                      className={`flex min-h-11 items-center px-3 rounded-md text-[14px] font-medium cursor-pointer data-[highlighted]:bg-hover data-[highlighted]:text-fg ${
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
            <kbd className="hidden sm:inline-block rounded bg-hover px-1.5 py-0.5 font-mono text-[10px] text-fg-3">&#x2318;K</kbd>
          </IconButton>
          <IconButton
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
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
            aria-controls="mobile-navigation"
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
        <div id="mobile-navigation" className="md:hidden border-t border-border bg-glass backdrop-blur-xl anim-enter">
          <div className="max-w-5xl mx-auto px-4 py-3 grid grid-cols-2 gap-1.5">
            {allLinks.map((link) => {
              const active = isActive(pathname, link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setDrawerOpen(false)}
                  aria-current={active ? "page" : undefined}
                  className={`inline-flex min-h-11 items-center rounded-lg px-3 text-[14px] font-medium transition-colors ${
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

const LINK_CLASS =
  "nav-dot inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-[14px] font-medium transition-all duration-150";

// A primary nav link. Digest gets a lazy hover preview of the latest issue's
// top stories — a zero-click glance at what's new, in the spirit of
// Perplexity's hover-revealed sidebar. The preview only mounts on hover, so it
// costs nothing until then.
function NavPrimaryLink({ link, active }: { link: { href: string; label: string }; active: boolean }) {
  const [hovered, setHovered] = useState(false);
  const hasPreview = link.href === "/digest";

  return (
    <div
      className="relative"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Link
        href={link.href}
        aria-current={active ? "page" : undefined}
        className={`${LINK_CLASS} ${active ? "active text-fg shadow-[inset_0_-1px_0_var(--border-hover)]" : "text-fg-3 hover:text-fg-2 hover:bg-hover"}`}
      >
        {link.label}
      </Link>
      {hasPreview && hovered && (
        // pt-2 keeps an invisible bridge so the pointer can cross the gap into
        // the panel without dropping the hover.
        <div className="absolute left-0 top-full z-50 pt-2">
          <DigestNavPreview />
        </div>
      )}
    </div>
  );
}

function DigestNavPreview() {
  const { data } = useDigestIssues({ limit: 1 });
  const issue = data?.issues?.[0];
  const rank: Record<string, number> = { High: 3, Medium: 2, Low: 1 };
  const stories: DigestStory[] = [...(issue?.stories || [])]
    .sort((a, b) => (rank[b.impact || "Low"] || 0) - (rank[a.impact || "Low"] || 0))
    .slice(0, 4);

  return (
    <div className="w-80 overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-l)] anim-enter">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="label-mono">{issue ? issue.weekOf : "Latest digest"}</span>
        {issue && (
          <span className="font-mono text-[10px] text-fg-3">{issue.storyCount} stories</span>
        )}
      </div>
      <div className="p-1.5">
        {!issue ? (
          <div className="px-2 py-6 text-center text-[12px] text-fg-3">Loading…</div>
        ) : (
          stories.map((s) => (
            <Link
              key={s.id}
              href={`/digest/issues/${issue.slug}#${s.id}`}
              className="flex items-start gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-hover"
            >
              <span className="mt-0.5 text-[13px] leading-none">{getFlag(s.jurisdictionCode || "")}</span>
              <span className="line-clamp-2 text-[12.5px] leading-snug text-fg-2">{s.title}</span>
            </Link>
          ))
        )}
      </div>
    </div>
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
        className="hidden min-h-11 lg:inline-flex items-center gap-1.5 px-2.5 rounded-lg text-[13px] font-medium text-accent-text hover:bg-hover transition-all duration-150"
        title="Your profile shapes every output — set it up"
      >
        Set up profile →
      </Link>
    );
  }

  return (
    <Link
      href="/settings"
      className="hidden min-h-11 lg:inline-flex items-center gap-1.5 px-2.5 rounded-lg text-[13px] font-medium text-fg-3 hover:text-fg-2 hover:bg-hover transition-all duration-150"
      title={`Argus is acting for ${companyName}${profile?.role ? ` · ${profile.role}` : ""} — click to edit profile`}
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />
      {companyName}
    </Link>
  );
}
