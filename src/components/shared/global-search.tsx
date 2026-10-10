"use client";

import { Command } from "cmdk";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import { getFlag } from "@/lib/digest-utils";
import { openCaptureModal } from "@/components/shared/capture-modal";
import { useTheme } from "@/components/layout/theme-provider";
import {
  Database,
  BookOpen,
  Library,
  Radar,
  Landmark,
  Tag,
  ArrowRight,
  Plus,
  MessagesSquare,
  Sparkles,
  FilePlus2,
  SunMoon,
  CalendarClock,
  Settings as SettingsIcon,
  type LucideIcon,
} from "lucide-react";

interface SearchItem {
  id: string;
  kind: "entry" | "story" | "knowledge" | "signal" | "regulator" | "tag";
  title: string;
  subtitle?: string;
  href: string;
  keywords?: string;
  jurisdiction?: string;
  badge?: string;
}

interface SearchIndexResponse {
  items: SearchItem[];
  generatedAt: string;
}

const KIND_META: Record<SearchItem["kind"], { heading: string; icon: LucideIcon }> = {
  entry: { heading: "Tracker", icon: Database },
  story: { heading: "Digest Stories", icon: BookOpen },
  knowledge: { heading: "Library", icon: Library },
  signal: { heading: "Signals", icon: Radar },
  regulator: { heading: "Regulators", icon: Landmark },
  tag: { heading: "Tags", icon: Tag },
};

// Render order for groups. Entries first — "which law was that?" is the most
// common palette question and the answer should be under the cursor.
const KIND_ORDER: SearchItem["kind"][] = ["entry", "story", "knowledge", "signal", "regulator", "tag"];

const NAV_ITEMS = [
  { label: "Dashboard", path: "/" },
  { label: "Ask", path: "/ask" },
  { label: "Tracker", path: "/tracker" },
  { label: "Tracker · Upcoming", path: "/tracker?lifecycle=upcoming" },
  { label: "Digest", path: "/digest" },
  { label: "All Digest Issues", path: "/digest/issues" },
  { label: "Library · Topics", path: "/library" },
  { label: "Library · Shelf", path: "/library/shelf" },
  { label: "Methodology", path: "/methodology" },
  { label: "Settings", path: "/settings" },
];

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface CommandDef {
  id: string;
  label: string;
  icon: LucideIcon;
  keywords: string;
  run: () => void;
}

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  // Fetch lazily on first open, then keep the index cached for the session so
  // reopening the palette is instant. Filtering happens entirely client-side.
  const [everOpened, setEverOpened] = useState(false);
  const [query, setQuery] = useState("");
  const router = useRouter();
  const pathname = usePathname();
  const { toggleTheme } = useTheme();

  // Scope-aware actions: when the current route is a specific tracker entry,
  // the palette can act on it ("Ask about this", "Run full analysis").
  const entryMatch = pathname.match(/^\/tracker\/([^/]+)$/);
  const currentEntryId =
    entryMatch && entryMatch[1] !== "horizon" && entryMatch[1] !== "new" ? entryMatch[1] : null;

  const { data, isLoading } = useSWR<SearchIndexResponse>(
    everOpened ? "/api/search" : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 }
  );
  const items = useMemo(() => data?.items || [], [data]);

  // Open on ⌘K (search mode) or "/" (command mode, prefilled). "/" is ignored
  // while the user is typing in a field so it stays a normal character there.
  useEffect(() => {
    function isTypingTarget(el: EventTarget | null) {
      const node = el as HTMLElement | null;
      if (!node) return false;
      const tag = node.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || node.isContentEditable;
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => {
          if (!prev) {
            setEverOpened(true);
            setQuery("");
          }
          return !prev;
        });
        return;
      }
      if (e.key === "/" && !open && !isTypingTarget(e.target)) {
        e.preventDefault();
        setEverOpened(true);
        setQuery("/");
        setOpen(true);
        return;
      }
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  const go = useCallback(
    (path: string) => {
      setOpen(false);
      router.push(path);
    },
    [router]
  );

  const ask = useCallback(
    (q: string) => {
      const trimmed = q.trim();
      setOpen(false);
      router.push(trimmed ? `/ask?q=${encodeURIComponent(trimmed)}` : "/ask");
    },
    [router]
  );

  const currentEntryTitle =
    currentEntryId ? items.find((i) => i.kind === "entry" && i.id === currentEntryId)?.title : undefined;

  const askAboutEntry = useCallback(() => {
    if (!currentEntryId) return;
    setOpen(false);
    const params = new URLSearchParams({ scopeKind: "entry", scopeId: currentEntryId });
    if (currentEntryTitle) params.set("scopeLabel", currentEntryTitle);
    router.push(`/ask?${params.toString()}`);
  }, [currentEntryId, currentEntryTitle, router]);

  const runAnalysis = useCallback(async () => {
    if (!currentEntryId) return;
    setOpen(false);
    try {
      const res = await fetch(`/api/tracker/entries/${currentEntryId}/generate-summary`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      toast.success("Full analysis started");
    } catch (err) {
      toast.error("Couldn't start analysis", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }, [currentEntryId]);

  // The command set (the "/" panel). Scope-specific commands come first when
  // they apply, so acting on the record you're looking at is one keystroke.
  const commands = useMemo<CommandDef[]>(() => {
    const list: CommandDef[] = [];
    if (currentEntryId) {
      list.push({
        id: "ask-entry",
        label: `Ask about ${currentEntryTitle ? `“${currentEntryTitle}”` : "this entry"}`,
        icon: MessagesSquare,
        keywords: "ask scoped current entry question",
        run: askAboutEntry,
      });
      list.push({
        id: "run-analysis",
        label: "Run full analysis",
        icon: Sparkles,
        keywords: "regenerate analyse summary current entry",
        run: runAnalysis,
      });
    }
    list.push(
      { id: "ask", label: "Ask Argus a question", icon: MessagesSquare, keywords: "ask question query", run: () => ask("") },
      { id: "capture", label: "Capture URL or text", icon: Plus, keywords: "add tracker clip save", run: () => { setOpen(false); openCaptureModal(); } },
      { id: "new-entry", label: "New tracker entry", icon: FilePlus2, keywords: "create add law", run: () => go("/tracker/new") },
      { id: "upcoming", label: "View upcoming legislation", icon: CalendarClock, keywords: "deadlines dates upcoming calendar horizon", run: () => go("/tracker?lifecycle=upcoming") },
      { id: "digest", label: "Open latest Digest", icon: BookOpen, keywords: "news issue weekly", run: () => go("/digest") },
      { id: "tags", label: "Browse Digest tags", icon: Tag, keywords: "topics categories jurisdictions", run: () => go("/digest/tags") },
      { id: "theme", label: "Toggle light / dark theme", icon: SunMoon, keywords: "dark mode appearance", run: () => { toggleTheme(); setOpen(false); } },
      { id: "settings", label: "Open Settings", icon: SettingsIcon, keywords: "profile preferences", run: () => go("/settings") }
    );
    return list;
  }, [currentEntryId, currentEntryTitle, askAboutEntry, runAnalysis, ask, go, toggleTheme]);

  if (!open) return null;

  const commandMode = query.startsWith("/");
  const commandQuery = commandMode ? query.slice(1).trim().toLowerCase() : "";
  const searching = !commandMode && query.trim().length > 0;

  const filteredCommands = commandMode
    ? commands.filter(
        (c) => commandQuery === "" || `${c.label} ${c.keywords}`.toLowerCase().includes(commandQuery)
      )
    : [];

  // With no query, show a calm default: quick nav + the most recently updated
  // entries. The full corpus only renders once the user types, and cmdk's
  // fuzzy matcher ranks it.
  const visibleByKind: Record<string, SearchItem[]> = {};
  for (const kind of KIND_ORDER) {
    const ofKind = items.filter((i) => i.kind === kind);
    visibleByKind[kind] = commandMode ? [] : searching ? ofKind : kind === "entry" ? ofKind.slice(0, 6) : [];
  }

  return (
    <div className="fixed inset-0 z-[100]">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setOpen(false)} />
      <div className="fixed left-1/2 top-[14%] w-full max-w-xl -translate-x-1/2 px-4">
        <Command
          // In command mode we filter the small command set ourselves so the
          // leading "/" doesn't defeat cmdk's matcher; normal search keeps
          // cmdk's fuzzy ranking.
          shouldFilter={!commandMode}
          className="overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-l)]"
          label="Search or ask"
        >
          <Command.Input
            value={query}
            onValueChange={setQuery}
            onKeyDown={(e) => {
              // ⌘↵ from anywhere in the box asks the current query, so a full
              // question doesn't require arrowing up to the Ask row first.
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && searching) {
                e.preventDefault();
                ask(query);
              }
            }}
            placeholder="Search records, or ask a question…  (type / for commands)"
            className="w-full border-b border-border bg-transparent px-4 py-3.5 text-[15px] text-fg outline-none placeholder:text-fg-3"
            autoFocus
          />

          {/* Ask affordance — pinned directly under the input while searching, so
              "turn this into a question" is always the visible primary path
              (cmdk would otherwise sort a force-mounted row to the bottom). */}
          {searching && (
            <button
              type="button"
              onClick={() => ask(query)}
              className="flex w-full items-center gap-3 border-b border-border bg-accent-bg px-4 py-2.5 text-left text-[14px] text-accent-text transition-colors hover:bg-accent/15"
            >
              <Sparkles className="h-4 w-4 flex-shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                Ask Argus: <span className="font-medium text-fg">&ldquo;{query.trim()}&rdquo;</span>
              </span>
              <kbd className="flex-shrink-0 rounded bg-surface/70 px-1.5 py-0.5 font-mono text-[10px]">&#8984;&#8629;</kbd>
            </button>
          )}

          <Command.List className="max-h-[420px] overflow-y-auto p-2 scroll-py-2">
            <Command.Empty className="px-4 py-10 text-center text-[13px] text-fg-3">
              {isLoading ? "Loading index…" : commandMode ? "No matching command." : "No results found."}
            </Command.Empty>

            {/* Command panel ("/") */}
            {commandMode && filteredCommands.length > 0 && (
              <Command.Group
                heading="Commands"
                className="[&_[cmdk-group-heading]]:label-mono [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
              >
                {filteredCommands.map((c) => {
                  const Icon = c.icon;
                  return (
                    <Command.Item
                      key={c.id}
                      value={c.id}
                      onSelect={c.run}
                      className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-[14px] text-fg-2 data-[selected=true]:bg-hover data-[selected=true]:text-fg"
                    >
                      <Icon className="h-3.5 w-3.5 flex-shrink-0 text-fg-3" />
                      <span className="min-w-0 flex-1 truncate">{c.label}</span>
                    </Command.Item>
                  );
                })}
              </Command.Group>
            )}

            {KIND_ORDER.map((kind) => {
              const group = visibleByKind[kind];
              if (!group.length) return null;
              const { heading, icon: Icon } = KIND_META[kind];
              return (
                <Command.Group
                  key={kind}
                  heading={searching ? heading : "Recently updated"}
                  className="[&_[cmdk-group-heading]]:label-mono [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
                >
                  {group.map((item) => (
                    <Command.Item
                      key={item.id}
                      value={`${item.title} ${item.keywords || ""} ${item.id}`}
                      onSelect={() => go(item.href)}
                      className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-[14px] text-fg-2 data-[selected=true]:bg-hover data-[selected=true]:text-fg"
                    >
                      <Icon className="h-3.5 w-3.5 flex-shrink-0 text-fg-3" />
                      {item.jurisdiction && (
                        <span className="text-base leading-none">{getFlag(item.jurisdiction)}</span>
                      )}
                      <div className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{item.title}</span>
                        {item.subtitle && (
                          <span className="block truncate text-[11px] text-fg-3">{item.subtitle}</span>
                        )}
                      </div>
                      {item.badge && (
                        <span className="flex-shrink-0 font-mono text-[10px] text-fg-3">{item.badge}</span>
                      )}
                    </Command.Item>
                  ))}
                </Command.Group>
              );
            })}

            {/* Navigate — only in normal mode; command mode folds key jumps into
                the command list. */}
            {!commandMode && (
              <Command.Group
                heading="Navigate"
                className="[&_[cmdk-group-heading]]:label-mono [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
              >
                {NAV_ITEMS.map((item) => (
                  <Command.Item
                    key={item.path}
                    value={`go to ${item.label}`}
                    onSelect={() => go(item.path)}
                    className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-[14px] text-fg-2 data-[selected=true]:bg-hover data-[selected=true]:text-fg"
                  >
                    <ArrowRight className="h-3.5 w-3.5 flex-shrink-0 text-fg-3" />
                    <span>{item.label}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}
          </Command.List>

          <div className="flex items-center gap-3 border-t border-border px-4 py-2">
            <Hint keys="↑↓" label="navigate" />
            <Hint keys="↵" label={commandMode ? "run" : "open"} />
            {!commandMode && <Hint keys="⌘↵" label="ask" />}
            <Hint keys="/" label="commands" />
            <Hint keys="esc" label="close" />
          </div>
        </Command>
      </div>
    </div>
  );
}

function Hint({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-fg-3">
      <kbd className="rounded bg-hover px-1.5 py-0.5 font-mono text-[10px]">{keys}</kbd>
      {label}
    </span>
  );
}
