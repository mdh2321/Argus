"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { toast } from "sonner";
import { relativeTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonCards } from "@/components/ui/skeleton";
import { FolderKanban, Plus, ArrowRight } from "lucide-react";

interface Matter {
  id: string;
  name: string;
  description: string | null;
  updatedAt: string;
  itemCount: number;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

// Matters — workstream bundles. The Spaces analog: gather the tracker entries,
// digest stories and research threads that belong to one piece of work.
export default function MattersPage() {
  const { data, isLoading, mutate } = useSWR<{ matters: Matter[] }>("/api/matters", fetcher);
  const matters = data?.matters ?? [];
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function create() {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/matters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) throw new Error();
      setName("");
      setCreating(false);
      mutate();
      toast.success("Matter created");
    } catch {
      toast.error("Couldn't create the matter");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="anim-enter mx-auto max-w-3xl">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div className="relative grid-pattern py-4">
          <div className="relative z-10 flex items-center gap-2.5">
            <FolderKanban className="h-5 w-5" style={{ color: "var(--accent)" }} />
            <h1 className="text-gradient text-[28px] font-bold tracking-[-0.02em]">Matters</h1>
          </div>
          <p className="relative z-10 mt-1.5 max-w-lg text-[14px] text-fg-3">
            Bundle the entries, stories and threads that belong to one workstream — with its own working instructions.
          </p>
        </div>
        {!creating && (
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" />
            New matter
          </Button>
        )}
      </div>

      {creating && (
        <div className="mb-6 flex items-center gap-2 rounded-xl bg-surface p-3 shadow-[var(--shadow-card)]">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void create();
              if (e.key === "Escape") setCreating(false);
            }}
            placeholder="Matter name — e.g. EU AI Act readiness"
            autoFocus
            className="flex-1 bg-transparent px-2 text-[14px] text-fg outline-none placeholder:text-fg-3"
          />
          <Button onClick={() => void create()} disabled={busy || !name.trim()} size="sm">
            {busy ? "Creating…" : "Create"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setCreating(false)}>
            Cancel
          </Button>
        </div>
      )}

      {isLoading ? (
        <SkeletonCards count={3} />
      ) : matters.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="No matters yet"
          description="Create one to gather everything about a workstream in a single place."
          action={
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-3.5 w-3.5" />
              New matter
            </Button>
          }
        />
      ) : (
        <div className="space-y-2 stagger">
          {matters.map((m) => (
            <Link
              key={m.id}
              href={`/matters/${m.id}`}
              className="group flex items-center gap-3 rounded-xl bg-surface p-4 shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-card-hover)]"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold text-fg group-hover:text-accent transition-colors">
                  {m.name}
                </p>
                <p className="mt-0.5 font-mono text-[11px] text-fg-3">
                  {m.itemCount} item{m.itemCount === 1 ? "" : "s"} · updated {relativeTime(m.updatedAt)}
                </p>
              </div>
              <ArrowRight className="h-4 w-4 flex-shrink-0 text-fg-3 transition-colors group-hover:text-accent" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
