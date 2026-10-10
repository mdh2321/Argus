"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, ListFilter, MessageCircle, MessagesSquare, Newspaper, Workflow, Settings, Search, Plus, Sun, Moon } from "lucide-react";
import { ArgusLogo } from "@/components/ui/argus-logo";
import { useTheme } from "./theme-provider";
import { useProfile } from "@/hooks/use-profile";
import { openCaptureModal } from "@/components/shared/capture-modal";
import { ActivityPopover } from "./activity-popover";

const links = [
  { href: "/", label: "Overview", Icon: LayoutDashboard },
  { href: "/tracker", label: "Tracker", Icon: ListFilter },
  { href: "/ask", label: "Ask Argus", Icon: MessageCircle },
  { href: "/digest", label: "Digest", Icon: Newspaper },
  { href: "/saved", label: "Threads", Icon: MessagesSquare },
];

export function TopNav() {
  const pathname = usePathname();
  const { theme, toggleTheme } = useTheme();
  const { data } = useProfile();
  return (
    <aside className="workspace-nav">
      <Link href="/" className="workspace-brand" aria-label="Argus home"><ArgusLogo size={30} /><span>ARGUS</span></Link>
      <p className="workspace-caption">Legal intelligence</p>
      <nav aria-label="Primary navigation" className="space-y-1">
        {links.map(({ href, label, Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href) || (href === "/saved" && pathname.startsWith("/library"));
          return <Link key={href} href={href} aria-current={active ? "page" : undefined} className={`workspace-link ${active ? "is-current" : ""}`}><Icon size={18} strokeWidth={1.6} /><span>{label}</span></Link>;
        })}
      </nav>
      <div className="my-6 border-t border-border" />
      <nav aria-label="Workspace tools" className="space-y-1">
        <Link href="/automations" aria-current={pathname === "/automations" ? "page" : undefined} className={`workspace-link ${pathname === "/automations" ? "is-current" : ""}`}><Workflow size={18} strokeWidth={1.6} />Automations</Link>
        <button type="button" className="workspace-link w-full" onClick={() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))}><Search size={18} strokeWidth={1.6} />Search<kbd className="ml-auto text-[11px] opacity-60">⌘K</kbd></button>
      </nav>
      <div className="mt-auto pt-8">
        <button onClick={openCaptureModal} className="argus-primary w-full"><Plus size={16} />Capture a source</button>
        <div className="mt-5 flex items-center justify-between gap-1 border-t border-border pt-4">
          <Link href="/settings" className="flex min-w-0 items-center gap-2 text-[13px] text-fg-2 hover:text-fg"><Settings size={16} /><span className="truncate">{data?.profile?.companyName || "Settings"}</span></Link>
          <ActivityPopover />
          <button onClick={toggleTheme} className="rounded-lg p-2 text-fg-3 hover:bg-hover" aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}>{theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}</button>
        </div>
      </div>
    </aside>
  );
}
