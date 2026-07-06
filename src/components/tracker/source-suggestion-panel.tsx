"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Check, X, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { SOURCE_TIERS } from "@/lib/constants";

interface Candidate {
  url: string;
  hostname: string;
  title: string;
  snippet: string;
  tier: string;
  confidence: "high" | "medium" | "low";
  publishedDate: string | null;
}

interface ApprovedResult {
  url: string;
  documentId: string | null;
  ok: boolean;
  extracted: boolean;
  truncated: boolean;
  byteCount: number | null;
  error: string | null;
}

interface Props {
  entryId: string;
  onClose: () => void;
  onApproved: () => void;
}

export function SourceSuggestionPanel({ entryId, onClose, onApproved }: Props) {
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  // Which submit is in flight — drives per-button spinners. null when idle.
  const [submitAction, setSubmitAction] = useState<"add" | "analyze" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submitting = submitAction !== null;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/tracker/entries/${entryId}/suggest-sources`, {
      method: "POST",
    })
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json.error || "Search failed");
        return json as { candidates: Candidate[] };
      })
      .then((json) => {
        if (cancelled) return;
        setCandidates(json.candidates);
        // Pre-select high-confidence (primary_legislation / regulator) candidates.
        const preselected = new Set<string>(
          json.candidates
            .filter((c) => c.confidence === "high")
            .slice(0, 3)
            .map((c) => c.url)
        );
        setSelected(preselected);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [entryId]);

  function toggle(url: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }

  async function handleApprove(thenAnalyze: boolean) {
    if (selected.size === 0) return;
    setSubmitAction(thenAnalyze ? "analyze" : "add");
    try {
      const res = await fetch(`/api/tracker/entries/${entryId}/approve-sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: Array.from(selected), thenAnalyze }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        results?: ApprovedResult[];
        analyzing?: boolean;
        error?: string;
      };
      if (!res.ok || !json.ok) throw new Error(json.error || "Approve failed");

      const results = json.results ?? [];
      const okCount = results.filter((r) => r.documentId !== null).length;
      const partialCount = results.filter((r) => r.documentId !== null && !r.extracted).length;

      const added =
        partialCount > 0
          ? `Added ${okCount} source${okCount === 1 ? "" : "s"} (${partialCount} URL-only — text extraction failed)`
          : `Added ${okCount} source${okCount === 1 ? "" : "s"}`;
      if (json.analyzing) {
        toast.success(`${added} — full analysis started`);
      } else {
        toast.success(added);
      }
      onApproved();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add sources");
    } finally {
      setSubmitAction(null);
    }
  }

  return (
    <div className="mb-4 rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-[13px] font-semibold text-fg">Suggested sources</div>
          <div className="font-mono text-[11px] text-fg-3">
            Searched official registries, regulators &amp; courts
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded-md p-1 text-fg-3 transition-colors hover:bg-bg-hover hover:text-fg"
          aria-label="Close suggestions"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {loading && (
        <div className="flex items-center gap-2 py-6 text-[12px] text-fg-3">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Searching official sources…
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red/30 bg-red-bg p-3 text-[12px] text-fg-2">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-red" />
          <span>{error}</span>
        </div>
      )}

      {!loading && candidates && candidates.length === 0 && (
        <p className="py-6 text-center text-[12px] text-fg-3">
          No candidate sources found. Try adding a URL manually.
        </p>
      )}

      {!loading && candidates && candidates.length > 0 && (
        <>
          <ul className="divide-y divide-border/60">
            {candidates.map((c) => {
              const checked = selected.has(c.url);
              const tierConfig = SOURCE_TIERS.find((t) => t.value === c.tier);
              return (
                <li key={c.url} className="py-2.5">
                  <label className="flex cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(c.url)}
                      className="mt-1 h-4 w-4 cursor-pointer accent-accent"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[11px] text-fg-2">{c.hostname}</span>
                        {tierConfig && (
                          <span
                            className="rounded px-1.5 py-0.5 font-mono text-[9px] font-medium leading-none"
                            style={{
                              color: tierConfig.color,
                              background: `${tierConfig.color}15`,
                              border: `1px solid ${tierConfig.color}30`,
                            }}
                          >
                            {tierConfig.label}
                          </span>
                        )}
                        <span
                          className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-medium leading-none ${
                            c.confidence === "high"
                              ? "bg-accent/10 text-accent"
                              : c.confidence === "medium"
                                ? "bg-amber/10 text-amber"
                                : "bg-bg-hover text-fg-3"
                          }`}
                        >
                          {c.confidence}
                        </span>
                      </div>
                      <a
                        href={c.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-[13px] font-medium text-fg hover:text-accent"
                      >
                        {c.title}
                      </a>
                      {c.snippet && (
                        <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-fg-3">
                          {c.snippet}
                        </p>
                      )}
                    </div>
                    <ExternalLink className="mt-1 h-3 w-3 flex-shrink-0 text-fg-3" />
                  </label>
                </li>
              );
            })}
          </ul>

          <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
            <button
              onClick={onClose}
              disabled={submitting}
              className="rounded-md border border-border bg-bg px-3 py-1.5 font-mono text-[11px] text-fg-2 transition-colors hover:bg-bg-hover disabled:opacity-50"
            >
              Cancel
            </button>
            {/* Plain add — for when the user wants to attach more sources
                before running the (expensive) analysis. */}
            <button
              onClick={() => handleApprove(false)}
              disabled={selected.size === 0 || submitting}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg px-3 py-1.5 font-mono text-[11px] font-medium text-fg-2 transition-colors hover:bg-bg-hover disabled:opacity-50"
            >
              {submitAction === "add" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Check className="h-3 w-3" />
              )}
              {submitAction === "add"
                ? "Fetching…"
                : `Add ${selected.size} source${selected.size === 1 ? "" : "s"}`}
            </button>
            {/* A3 — the happy path: verify sources and run full analysis in one
                action. The deliberate step is judging sources, not clicking twice. */}
            <button
              onClick={() => handleApprove(true)}
              disabled={selected.size === 0 || submitting}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 font-mono text-[11px] font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {submitAction === "analyze" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Check className="h-3 w-3" />
              )}
              {submitAction === "analyze" ? "Starting…" : "Add & analyze"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
