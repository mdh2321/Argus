import type { Entry } from "./types";

export interface TrustBadge {
  label: string;
  className: string;
}

const STALE_DAYS = 180;

/** Compute passive trust badges for an entry (client-safe, no DB imports) */
export function computeTrustBadges(entry: Entry): TrustBadge[] {
  const badges: TrustBadge[] = [];

  // Retired because a newer instrument replaced it (repeal-and-replace). Leads
  // when present — it changes whether the entry is a live compliance surface.
  if (entry.status === "superseded") {
    badges.push({
      label: "Superseded",
      className: "bg-hover text-fg-3 border-[color:var(--fg-3)]/20",
    });
  }

  // Analysis predates a material change — most commonly an amending instrument
  // taking force (§2.4). Higher-signal than plain "Stale", so it leads. A
  // partial commencement gets its own softer label — only some provisions are
  // in force, so the analysis is incomplete rather than outright out of date.
  if (entry.analysisStaleReason) {
    const partial = entry.analysisStaleReason.startsWith("Partially amended");
    badges.push(
      partial
        ? {
            label: "Partially amended",
            className: "bg-amber-bg text-amber border-amber/20",
          }
        : {
            label: "Analysis predates amendment",
            className: "bg-[var(--red-bg)] text-[var(--red)] border-[color:var(--red)]/20",
          }
    );
  }

  const updatedAt = new Date(entry.updatedAt).getTime();
  const daysSinceUpdate = (Date.now() - updatedAt) / (1000 * 60 * 60 * 24);
  if (daysSinceUpdate > STALE_DAYS) {
    badges.push({
      label: "Stale",
      className: "bg-amber-bg text-amber border-amber/20",
    });
  }

  if (entry.aiGenerated) {
    const needsReview =
      !entry.lastReviewed ||
      new Date(entry.lastReviewed).getTime() < updatedAt;
    if (needsReview) {
      badges.push({
        label: "Needs Review",
        className: "bg-purple-bg text-purple border-purple/20",
      });
    }
  }

  return badges;
}
