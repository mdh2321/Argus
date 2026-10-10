"use client";

// Record state — replaces the v1 banner stack and the trust-badge row.
//
// v1 surfaced record health as up to five stacked banners (intake, preliminary,
// proposed changes, stale analysis, orphan satellite) plus a row of trust
// badges in the masthead. The dominant badge was "Needs Review", which
// `computeTrustBadges` assigns to every AI-generated entry whose lastReviewed
// predates its updatedAt — i.e. almost the entire tracker. A flag that is
// always on is not a flag.
//
// v2 grades by whether the reader has to do something:
//
//   blocking   the record is not a reliable statement of the law right now
//              (analysis predates an amendment; superseded; no primary text).
//              Earns an inline strip above the content.
//   advisory   worth knowing, does not change how you read the page
//              (preliminary depth, aged analysis). Lives in the rail line only.
//   routine    "AI-generated, not human-reviewed" — the default state of the
//              corpus. Stated once in the rail, never as a flag.

import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";
import type { Entry, SourceDocument } from "@/lib/types";

export type StateLevel = "blocking" | "advisory" | "routine";

export interface RecordStateItem {
  level: StateLevel;
  label: string;
  detail: string;
  /** Optional in-page action, e.g. regenerate the analysis. */
  action?: { label: string; onClick: () => void };
}

export function computeRecordState(
  entry: Entry,
  documents: SourceDocument[] | undefined,
  opts: { onRegenerate?: () => void } = {}
): RecordStateItem[] {
  const items: RecordStateItem[] = [];
  const docs = documents ?? [];
  const hasPrimary = docs.some((d) => d.role === "primary_text" && d.fullText);

  if (entry.status === "superseded") {
    items.push({
      level: "blocking",
      label: "Superseded",
      detail:
        "A newer instrument has replaced this one. It is no longer a live compliance surface — read the successor.",
    });
  }

  if (entry.analysisStaleReason) {
    const partial = entry.analysisStaleReason.startsWith("Partially amended");
    items.push({
      level: "blocking",
      label: partial ? "Partially amended" : "Analysis predates an amendment",
      detail: entry.analysisStaleReason,
      action: opts.onRegenerate
        ? { label: "Re-run analysis", onClick: opts.onRegenerate }
        : undefined,
    });
  }

  if (documents !== undefined && !hasPrimary) {
    items.push({
      level: "blocking",
      label: "No primary text attached",
      detail:
        "The instrument’s primary text is not available here. Attach it to check the analysis against the source.",
    });
  }

  if (entry.summaryDepth === "preliminary") {
    items.push({
      level: "advisory",
      label: "Preliminary analysis",
      detail:
        "Written from model knowledge without the source text in context. Treat conclusions as a starting point.",
    });
  }

  const ageDays = (Date.now() - new Date(entry.updatedAt).getTime()) / 86_400_000;
  if (ageDays > 180) {
    items.push({
      level: "advisory",
      label: `Record last updated ${Math.round(ageDays / 30)} months ago`,
      detail: "Check source freshness and whether the analysis needs updating.",
    });
  }

  if (entry.aiGenerated) {
    const reviewed =
      entry.lastReviewed && new Date(entry.lastReviewed).getTime() >= new Date(entry.updatedAt).getTime();
    items.push({
      level: "routine",
      label: reviewed ? "Reviewed by an analyst" : "AI-generated, not analyst-reviewed",
      detail: reviewed
        ? `Signed off ${new Date(entry.lastReviewed!).toLocaleDateString("en-AU")}.`
        : "Standard for the corpus. Claims carry section-level references you can check.",
    });
  }

  return items;
}

/** One-line verdict for the rail. States the worst live issue, or that there is none. */
export function stateSummary(items: RecordStateItem[], hasPrimary: boolean): string {
  const blocking = items.filter((i) => i.level === "blocking");
  if (blocking.length > 0) {
    return `${blocking[0].label}. Review before relying on this analysis.`;
  }
  const advisory = items.filter((i) => i.level === "advisory");
  if (advisory.length > 0) return `${advisory[0].label}. Other checks are listed below.`;
  return hasPrimary
    ? "Primary text attached. Open a citation to check its passage and source snapshot."
    : "Primary source text has not been confirmed.";
}

/**
 * Inline strip for blocking states only. Nothing advisory or routine ever
 * renders here — that is the whole point of the grading.
 */
export function BlockingStrip({
  items,
  proposedCount,
  entryId,
}: {
  items: RecordStateItem[];
  proposedCount: number;
  entryId: string;
}) {
  const blocking = items.filter((i) => i.level === "blocking");
  if (blocking.length === 0 && proposedCount === 0) return null;

  return (
    <div className="mb-6 space-y-2">
      {blocking.map((item) => (
        <div
          key={item.label}
          className="flex items-start gap-2.5 rounded-lg border border-[color:var(--amber)]/30 bg-amber-bg px-3 py-2.5"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-text" />
          <div className="min-w-0 flex-1 text-[15px] leading-snug">
            <span className="font-medium text-amber-text">{item.label}.</span>{" "}
            <span className="text-fg-2">{item.detail}</span>
          </div>
          {item.action && (
            <button
              type="button"
              onClick={item.action.onClick}
              className="flex-shrink-0 font-mono text-[12px] text-amber-text underline-offset-2 hover:underline"
            >
              {item.action.label}
            </button>
          )}
        </div>
      ))}

      {/* Proposed changes stay a strip: they are a queue awaiting a decision,
          which is the one banner that genuinely needs the reader to act. */}
      {proposedCount > 0 && (
        <Link
          href={`/tracker/${entryId}/legacy`}
          className="flex items-center gap-2.5 rounded-lg border border-border bg-surface px-3 py-2.5 transition-colors hover:border-border-hover"
        >
          <span className="text-[15px] text-fg-2">
            <span className="font-medium text-fg">
              {proposedCount} proposed {proposedCount === 1 ? "change" : "changes"}
            </span>{" "}
            from the digest awaiting review.
          </span>
          <ArrowRight className="ml-auto h-3.5 w-3.5 flex-shrink-0 text-fg-3" />
        </Link>
      )}
    </div>
  );
}
