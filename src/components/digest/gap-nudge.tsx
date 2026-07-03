"use client";

import { useState } from "react";
import Link from "next/link";
import {
  useGapSuggestions,
  triggerGenerateGapSuggestions,
  acceptGapSuggestion,
  dismissGapSuggestion,
} from "@/hooks/use-gap-suggestions";
import { getFlag } from "@/lib/digest-utils";
import { ENTRY_TYPES } from "@/lib/constants";
import { Lightbulb, Plus, X, RefreshCw, Loader2 } from "lucide-react";

function typeLabel(type: string | null): string {
  if (!type) return "Entry";
  return ENTRY_TYPES.find((t) => t.value === type)?.label || type;
}

export function GapNudge() {
  const { data, mutate, isLoading } = useGapSuggestions({ status: "pending" });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const suggestions = data?.suggestions || [];

  async function handleGenerate() {
    setGenerating(true);
    try {
      await triggerGenerateGapSuggestions();
      await mutate();
    } finally {
      setGenerating(false);
    }
  }

  async function handleAccept(id: string) {
    setBusyId(id);
    try {
      await acceptGapSuggestion(id);
      await mutate();
    } finally {
      setBusyId(null);
    }
  }

  async function handleDismiss(id: string) {
    setBusyId(id);
    try {
      await dismissGapSuggestion(id);
      await mutate();
    } finally {
      setBusyId(null);
    }
  }

  // Only render when we have something to show or the user triggers generation
  if (isLoading) return null;
  if (suggestions.length === 0) {
    return (
      <section className="mb-8">
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 font-mono text-[11px] uppercase tracking-[0.04em] text-fg-3 transition-colors hover:border-border-hover hover:text-fg-2 disabled:opacity-50"
        >
          {generating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Lightbulb className="h-3.5 w-3.5" />
          )}
          {generating ? "Scanning digest…" : "Scan digest for tracker gaps"}
        </button>
      </section>
    );
  }

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Lightbulb className="h-4 w-4" style={{ color: "var(--amber)" }} />
          <h2 className="text-[13px] font-semibold text-fg uppercase tracking-[0.04em] font-mono">
            Suggested to track
          </h2>
          <span className="font-mono text-[11px] text-fg-3">({suggestions.length})</span>
        </div>
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.04em] text-fg-3 transition-colors hover:text-accent disabled:opacity-50"
        >
          {generating ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          Rescan
        </button>
      </div>

      <ul className="space-y-2 stagger">
        {suggestions.map((s) => {
          const busy = busyId === s.id;
          return (
            <li
              key={s.id}
              className="rounded-xl border border-border bg-surface p-4 transition-colors hover:border-border-hover"
            >
              <div className="mb-2 flex items-start gap-3">
                <span className="mt-0.5 text-base leading-none">
                  {getFlag(s.suggestedJurisdiction)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <h3 className="text-[15px] font-semibold text-fg">
                      {s.suggestedShortName}
                    </h3>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-fg-3">
                      {typeLabel(s.suggestedType)}
                    </span>
                    {s.suggestedRegulator && (
                      <span className="font-mono text-[10px] text-fg-3">
                        &middot; {s.suggestedRegulator}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[13px] leading-relaxed text-fg-2">
                    {s.rationale}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-fg-3">
                    <span>{s.suggestedCategory}</span>
                    {s.source === "scan" ? (
                      <>
                        <span>&middot;</span>
                        <span className="text-accent">via landscape scan</span>
                      </>
                    ) : s.sourceStoryTitle ? (
                      <>
                        <span>&middot;</span>
                        <span className="truncate max-w-[280px]" title={s.sourceStoryTitle}>
                          From: {s.sourceStoryTitle}
                        </span>
                      </>
                    ) : null}
                    {s.sourceUrls && s.sourceUrls.length > 0 && (
                      <>
                        <span>&middot;</span>
                        <a
                          href={s.sourceUrls[0]}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:text-accent"
                        >
                          primary source ↗
                        </a>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex flex-shrink-0 items-center gap-1">
                  <button
                    onClick={() => handleAccept(s.id)}
                    disabled={busy}
                    className="inline-flex items-center gap-1 rounded-full border border-accent/20 bg-accent-bg px-2.5 py-1 font-mono text-[11px] font-medium text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
                  >
                    {busy ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Plus className="h-3 w-3" />
                    )}
                    Track
                  </button>
                  <button
                    onClick={() => handleDismiss(s.id)}
                    disabled={busy}
                    title="Dismiss"
                    className="inline-flex items-center rounded-full border border-border px-2 py-1 text-fg-3 transition-colors hover:border-border-hover hover:text-fg-2 disabled:opacity-50"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// Linked-from for the accepted entry
export function GapNudgeLink({ entryId }: { entryId: string }) {
  return (
    <Link
      href={`/tracker/${entryId}`}
      className="font-mono text-[11px] text-accent hover:underline"
    >
      view in tracker →
    </Link>
  );
}
