"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Archive, Plus, Loader2, Pin, FileText, ChevronRight } from "lucide-react";
import { BriefingCard } from "@/components/library/briefing-card";
import { GenerateBriefingDialog } from "@/components/library/generate-briefing-dialog";
import type { KnowledgeItem } from "@/lib/types";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function stampDate(item: KnowledgeItem) {
  const d = item.lastGenerated || item.createdAt;
  return new Date(d).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

// The Shelf: frozen, dated artifacts. The wiki is living and undated; the
// shelf is stamped and never auto-updated — that distinction is the point.
export default function ShelfPage() {
  const { data, isLoading, mutate } = useSWR<{ items: KnowledgeItem[] }>("/api/library/shelf", fetcher);
  const [dialogOpen, setDialogOpen] = useState(false);
  const items = data?.items || [];

  return (
    <>
      <div className="anim-enter">
        <div className="mb-8 flex items-center justify-between">
          <div className="relative grid-pattern py-4">
            <div className="relative z-10 flex items-center gap-2.5">
              <Archive className="h-5 w-5" style={{ color: "var(--purple)" }} />
              <h1 className="text-gradient text-[28px] font-bold tracking-[-0.02em]">Shelf</h1>
            </div>
            <p className="relative z-10 mt-1.5 max-w-xl text-[14px] text-fg-3">
              Frozen, dated artifacts — briefings, pinned Ask answers, comparisons.
              Stamped at generation, never auto-updated.
            </p>
          </div>
          <button
            onClick={() => setDialogOpen(true)}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-[12px] font-medium text-white transition-all hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" />
            Generate briefing
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-5 w-5 animate-spin text-fg-3" />
          </div>
        ) : items.length === 0 ? (
          <div className="py-20 text-center">
            <Archive className="mx-auto mb-3 h-10 w-10 text-fg-3 opacity-40" />
            <p className="mb-2 text-[14px] text-fg-3">The shelf is empty</p>
            <p className="text-[12px] text-fg-3">
              Generate a briefing, or pin an Ask answer to keep a dated snapshot here.
            </p>
          </div>
        ) : (
          <div className="space-y-3 stagger">
            {items.map((item) =>
              item.itemType === "briefing" ? (
                <BriefingCard key={item.id} briefing={item} />
              ) : (
                <ShelfRow key={item.id} item={item} />
              )
            )}
          </div>
        )}
      </div>

      <GenerateBriefingDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onGenerated={() => mutate()}
      />
    </>
  );
}

// Compact row for non-briefing artifacts (pinned answers, comparisons).
function ShelfRow({ item }: { item: KnowledgeItem }) {
  const Icon = item.itemType === "pinned_answer" ? Pin : FileText;
  const kindLabel = item.itemType === "pinned_answer" ? "Pinned answer" : "Comparison";
  return (
    <Link
      href={`/library/briefings/${item.id}`}
      className="group flex items-center gap-3 rounded-xl border border-border bg-surface p-5 transition-all hover:border-border-hover hover:shadow-[var(--shadow-card)]"
    >
      <Icon className="h-4 w-4 flex-shrink-0 text-fg-3" strokeWidth={1.5} />
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-[15px] font-semibold text-fg transition-colors group-hover:text-accent">
          {item.title}
        </h3>
        <span className="font-mono text-[11px] text-fg-3">
          {kindLabel} · {stampDate(item)}
        </span>
      </div>
      <ChevronRight className="h-4 w-4 flex-shrink-0 text-fg-3" />
    </Link>
  );
}
