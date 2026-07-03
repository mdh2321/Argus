"use client";

import { Command } from "cmdk";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { getFlag } from "@/lib/digest-utils";
import {
  Database,
  BookOpen,
  Library,
  Radar,
  Landmark,
  Tag,
  ArrowRight,
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
  { label: "Tracker · Horizon", path: "/tracker/horizon" },
  { label: "Digest", path: "/digest" },
  { label: "All Digest Issues", path: "/digest/issues" },
  { label: "Library · Topics", path: "/library" },
  { label: "Library · Shelf", path: "/library/shelf" },
  { label: "Methodology", path: "/methodology" },
  { label: "Settings", path: "/settings" },
];

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  // Fetch lazily on first open, then keep the index cached for the session so
  // reopening the palette is instant. Filtering happens entirely client-side.
  const [everOpened, setEverOpened] = useState(false);
  const [query, setQuery] = useState("");
  const router = useRouter();

  const { data, isLoading } = useSWR<SearchIndexResponse>(
    everOpened ? "/api/search" : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 }
  );
  const items = data?.items || [];

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => {
          if (!prev) {
            setEverOpened(true);
            // Fresh query on every open — a palette that remembers its last
            // search costs a manual clear on every meeting-speed lookup.
            setQuery("");
          }
          return !prev;
        });
      }
      if (e.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const go = useCallback(
    (path: string) => {
      setOpen(false);
      router.push(path);
    },
    [router]
  );

  if (!open) return null;

  const searching = query.trim().length > 0;

  // With no query, show a calm default: quick nav + the most recently updated
  // entries. The full corpus only renders once the user types, and cmdk's
  // fuzzy matcher ranks it.
  const visibleByKind: Record<string, SearchItem[]> = {};
  for (const kind of KIND_ORDER) {
    const ofKind = items.filter((i) => i.kind === kind);
    visibleByKind[kind] = searching ? ofKind : kind === "entry" ? ofKind.slice(0, 6) : [];
  }

  return (
    <div className="fixed inset-0 z-[100]">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setOpen(false)} />
      <div className="fixed left-1/2 top-[14%] w-full max-w-xl -translate-x-1/2 px-4">
        <Command
          className="overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-l)]"
          label="Global search"
        >
          <Command.Input
            value={query}
            onValueChange={setQuery}
            placeholder="Search laws, stories, regulators, tags…"
            className="w-full border-b border-border bg-transparent px-4 py-3.5 text-[15px] text-fg outline-none placeholder:text-fg-3"
            autoFocus
          />
          <Command.List className="max-h-[420px] overflow-y-auto p-2 scroll-py-2">
            <Command.Empty className="px-4 py-10 text-center text-[13px] text-fg-3">
              {isLoading ? "Loading index…" : "No results found."}
            </Command.Empty>

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
          </Command.List>

          <div className="flex items-center gap-3 border-t border-border px-4 py-2">
            <Hint keys="↑↓" label="navigate" />
            <Hint keys="↵" label="open" />
            <Hint keys="esc" label="close" />
            {items.length > 0 && (
              <span className="ml-auto font-mono text-[10px] text-fg-3">
                {items.length} items indexed
              </span>
            )}
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
