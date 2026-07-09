"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Bot,
  FolderKanban,
  Trash2,
  Plus,
  X,
  Database,
  BookOpen,
  Library as LibraryIcon,
  Radar,
  MessagesSquare,
  type LucideIcon,
} from "lucide-react";

interface Matter {
  id: string;
  name: string;
  description: string | null;
  instructions: string | null;
}
interface MatterItem {
  id: string;
  kind: string;
  refId: string;
  label: string;
  href: string;
}
interface SearchItem {
  id: string;
  kind: string;
  title: string;
  href: string;
  subtitle?: string;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

// Which search kinds can be bundled into a matter, and how each renders.
const KIND_META: Record<string, { label: string; icon: LucideIcon }> = {
  entry: { label: "Tracker entries", icon: Database },
  story: { label: "Digest stories", icon: BookOpen },
  knowledge: { label: "Library", icon: LibraryIcon },
  signal: { label: "Signals", icon: Radar },
  thread: { label: "Threads", icon: MessagesSquare },
  briefing: { label: "Briefings", icon: LibraryIcon },
};
const ADDABLE = new Set(["entry", "story", "knowledge", "signal"]);
const KIND_ORDER = ["entry", "story", "knowledge", "signal", "thread", "briefing"];

export default function MatterDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data, isLoading, mutate } = useSWR<{ matter: Matter; items: MatterItem[] }>(
    `/api/matters/${id}`,
    fetcher
  );
  const matter = data?.matter;
  const items = useMemo(() => data?.items ?? [], [data]);

  const [instructions, setInstructions] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // Instructions are edited locally, persisted on blur.
  const instructionValue = instructions ?? matter?.instructions ?? "";

  async function saveInstructions() {
    if ((matter?.instructions ?? "") === instructionValue) return;
    await fetch(`/api/matters/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instructions: instructionValue }),
    });
    mutate();
    toast.success("Instructions saved");
  }

  async function removeItem(itemId: string) {
    await fetch(`/api/matters/${id}/items/${itemId}`, { method: "DELETE" });
    mutate();
  }

  async function deleteMatter() {
    if (!confirm("Delete this matter? Its item list is removed; the underlying records are untouched.")) return;
    await fetch(`/api/matters/${id}`, { method: "DELETE" });
    toast.success("Matter deleted");
    router.push("/matters");
  }

  if (!isLoading && !matter) {
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyState
          icon={FolderKanban}
          title="Matter not found"
          description="It may have been deleted."
          action={
            <Link href="/matters" className="font-mono text-[11px] uppercase tracking-[0.04em] text-accent-text hover:text-accent">
              ← All matters
            </Link>
          }
        />
      </div>
    );
  }

  const grouped = KIND_ORDER.map((kind) => ({ kind, list: items.filter((i) => i.kind === kind) })).filter(
    (g) => g.list.length > 0
  );

  return (
    <div className="anim-enter mx-auto max-w-3xl">
      <nav className="label-mono mb-5 flex items-center gap-2">
        <Link href="/matters" className="transition-colors hover:text-accent">
          Matters
        </Link>
        <span>&gt;</span>
        <span className="text-fg-2">{matter?.name ?? "…"}</span>
      </nav>

      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <FolderKanban className="h-5 w-5 text-accent" />
          <h1 className="text-[24px] font-bold tracking-[-0.02em] text-fg">{matter?.name}</h1>
        </div>
        <div className="flex items-center gap-1.5">
          <Link
            href={`/ask?scopeKind=matter&scopeId=${id}&scopeLabel=${encodeURIComponent(matter?.name ?? "")}`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent/10 px-3 py-1.5 font-mono text-[11px] font-medium text-accent transition-colors hover:bg-accent/20"
            title="Ask Argus with this matter's items and working instructions as context"
          >
            <Bot className="h-3 w-3" />
            Ask about this matter
          </Link>
          <button
            onClick={() => void deleteMatter()}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.04em] text-fg-3 transition-colors hover:bg-red-bg hover:text-red"
            title="Delete matter"
          >
            <Trash2 className="h-3 w-3" />
            Delete
          </button>
        </div>
      </div>

      {/* Working instructions — steer analysis scoped to this matter. */}
      <section className="mb-8">
        <h2 className="label-mono mb-2">Working instructions</h2>
        <textarea
          value={instructionValue}
          onChange={(e) => setInstructions(e.target.value)}
          onBlur={() => void saveInstructions()}
          rows={3}
          placeholder="What matters here — e.g. 'We only care about Annex III high-risk classification and the conformity-assessment timeline.'"
          className="w-full resize-y rounded-xl bg-surface p-3.5 text-[13.5px] leading-relaxed text-fg-2 shadow-[var(--shadow-card)] outline-none placeholder:text-fg-3 focus:ring-1 focus:ring-accent"
        />
      </section>

      {/* Items */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="label-mono">Bundled items</h2>
          <Button size="sm" variant="secondary" onClick={() => setAdding((a) => !a)}>
            <Plus className="h-3 w-3" />
            Add items
          </Button>
        </div>

        {adding && <AddItems matterId={id} onAdded={() => mutate()} existing={items} />}

        {grouped.length === 0 ? (
          <EmptyState
            size="sm"
            icon={FolderKanban}
            title="Nothing bundled yet"
            description="Add tracker entries, digest stories, or signals that belong to this matter."
          />
        ) : (
          <div className="space-y-6">
            {grouped.map(({ kind, list }) => {
              const meta = KIND_META[kind] ?? { label: kind, icon: FolderKanban };
              const Icon = meta.icon;
              return (
                <div key={kind}>
                  <div className="mb-2 flex items-center gap-1.5 label-mono">
                    <Icon className="h-3.5 w-3.5" />
                    {meta.label}
                    <span className="text-fg-3">· {list.length}</span>
                  </div>
                  <div className="space-y-1.5">
                    {list.map((it) => (
                      <div
                        key={it.id}
                        className="group flex items-center gap-3 rounded-lg bg-surface px-3 py-2 shadow-[var(--shadow-s)]"
                      >
                        <Link href={it.href} className="min-w-0 flex-1 truncate text-[13px] text-fg-2 hover:text-accent">
                          {it.label}
                        </Link>
                        <button
                          onClick={() => void removeItem(it.id)}
                          className="flex-shrink-0 rounded p-1 text-fg-3 opacity-0 transition-all hover:bg-hover hover:text-red group-hover:opacity-100"
                          title="Remove from matter"
                          aria-label="Remove from matter"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function AddItems({
  matterId,
  onAdded,
  existing,
}: {
  matterId: string;
  onAdded: () => void;
  existing: MatterItem[];
}) {
  const { data } = useSWR<{ items: SearchItem[] }>("/api/search", fetcher, {
    revalidateOnFocus: false,
  });
  const [q, setQ] = useState("");
  const present = useMemo(
    () => new Set(existing.map((i) => `${i.kind}:${i.refId}`)),
    [existing]
  );

  const results = useMemo(() => {
    const all = (data?.items ?? []).filter((i) => ADDABLE.has(i.kind));
    const query = q.trim().toLowerCase();
    if (!query) return [];
    return all.filter((i) => i.title.toLowerCase().includes(query)).slice(0, 8);
  }, [data, q]);

  async function add(item: SearchItem) {
    await fetch(`/api/matters/${matterId}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: item.kind, refId: item.id, label: item.title, href: item.href }),
    });
    onAdded();
    toast.success("Added to matter");
  }

  return (
    <div className="mb-5 rounded-xl bg-surface p-3 shadow-[var(--shadow-card)]">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search entries, stories, signals to add…"
        autoFocus
        className="w-full bg-transparent px-2 py-1 text-[14px] text-fg outline-none placeholder:text-fg-3"
      />
      {q.trim() && (
        <div className="mt-2 space-y-1">
          {results.length === 0 ? (
            <div className="px-2 py-3 text-center text-[12px] text-fg-3">No matches.</div>
          ) : (
            results.map((item) => {
              const already = present.has(`${item.kind}:${item.id}`);
              return (
                <button
                  key={`${item.kind}:${item.id}`}
                  onClick={() => !already && void add(item)}
                  disabled={already}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-hover disabled:opacity-50"
                >
                  <span className="min-w-0 flex-1 truncate text-[13px] text-fg-2">{item.title}</span>
                  <span className="flex-shrink-0 font-mono text-[10px] uppercase tracking-[0.04em] text-fg-3">
                    {already ? "added" : item.kind}
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
