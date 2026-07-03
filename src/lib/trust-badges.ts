import type { Entry } from "./types";

export interface TrustBadge {
  label: string;
  className: string;
}

const STALE_DAYS = 180;

/** Compute passive trust badges for an entry (client-safe, no DB imports) */
export function computeTrustBadges(entry: Entry): TrustBadge[] {
  const badges: TrustBadge[] = [];

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
