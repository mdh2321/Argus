"use client";

import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import useSWR from "swr";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FolderKanban, Plus, Loader2 } from "lucide-react";

interface MatterSummary {
  id: string;
  name: string;
  itemCount: number;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

// One-tap "file this under a workstream" — the per-surface companion to the
// Matters MVP. Renders a small ghost trigger; the popover lists existing
// matters (newest-touched first) plus a quick-create row. Adding is
// idempotent server-side, so re-filing is always safe.
export function AddToMatterButton({
  kind,
  refId,
  label,
  href,
  iconOnly = false,
  className = "",
}: {
  kind: "entry" | "story" | "thread" | "signal" | "knowledge" | "briefing";
  refId: string;
  label: string;
  href: string;
  iconOnly?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const router = useRouter();
  // Lazy: only hit the API once the popover opens.
  const { data, mutate } = useSWR<{ matters: MatterSummary[] }>(
    open ? "/api/matters" : null,
    fetcher
  );
  const matters = data?.matters ?? [];

  async function addTo(matterId: string, matterName: string) {
    setBusyId(matterId);
    try {
      const res = await fetch(`/api/matters/${matterId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, refId, label, href }),
      });
      const json = (await res.json()) as { alreadyPresent?: boolean; error?: string };
      if (!res.ok) throw new Error(json.error || "Couldn't add to matter");
      if (json.alreadyPresent) {
        toast.message(`Already in ${matterName}`);
      } else {
        toast.success(`Added to ${matterName}`, {
          action: { label: "Open", onClick: () => router.push(`/matters/${matterId}`) },
        });
      }
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't add to matter");
    } finally {
      setBusyId(null);
    }
  }

  async function createAndAdd() {
    const name = newName.trim();
    if (!name) return;
    setBusyId("new");
    try {
      const res = await fetch("/api/matters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const json = (await res.json()) as { id?: string; error?: string };
      if (!res.ok || !json.id) throw new Error(json.error || "Couldn't create matter");
      setNewName("");
      await mutate();
      await addTo(json.id, name);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create matter");
      setBusyId(null);
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          title="Add to a matter"
          className={
            className ||
            "flex items-center gap-1 text-[11px] font-mono text-fg-3 transition-colors hover:text-accent"
          }
        >
          <FolderKanban className="w-3 h-3" />
          {!iconOnly && "Matter"}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          collisionPadding={16}
          className="z-50 w-[260px] rounded-xl border border-border bg-surface p-2 shadow-xl"
          onClick={(e) => e.stopPropagation()}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="mb-1 px-2 pt-1 font-mono text-[10px] uppercase tracking-wide text-fg-3">
            Add to matter
          </div>
          <div className="max-h-[220px] overflow-y-auto">
            {matters.length === 0 && (
              <div className="px-2 py-2 text-[12px] text-fg-3">
                {data ? "No matters yet — create one below." : "Loading…"}
              </div>
            )}
            {matters.map((m) => (
              <button
                key={m.id}
                type="button"
                disabled={busyId !== null}
                onClick={() => addTo(m.id, m.name)}
                className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-fg transition-colors hover:bg-hover disabled:opacity-50"
              >
                <span className="truncate">{m.name}</span>
                {busyId === m.id ? (
                  <Loader2 className="h-3 w-3 flex-shrink-0 animate-spin text-fg-3" />
                ) : (
                  <span className="flex-shrink-0 font-mono text-[10px] tabular-nums text-fg-3">
                    {m.itemCount}
                  </span>
                )}
              </button>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void createAndAdd();
            }}
            className="mt-1 flex items-center gap-1 border-t border-border pt-2"
          >
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New matter…"
              className="min-w-0 flex-1 rounded-lg bg-hover px-2 py-1.5 text-[12px] text-fg placeholder:text-fg-3 outline-none"
            />
            <button
              type="submit"
              disabled={!newName.trim() || busyId !== null}
              className="flex-shrink-0 rounded-lg bg-hover p-1.5 text-fg-2 transition-colors hover:text-accent disabled:opacity-50"
              aria-label="Create matter and add"
            >
              {busyId === "new" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
            </button>
          </form>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
