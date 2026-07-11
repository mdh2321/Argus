// Anchor / satellite classification (Entry & Source Model plan §2.1).
//
// An ANCHOR is the compliance surface: principal legislation, regulations, and
// binding guidance carry full analysis. A new-law BILL with no `amends` link is
// an anchor-in-embryo (it will become the principal instrument on commencement).
//
// A SATELLITE is everything that hangs off an anchor — amending acts, bills that
// amend, consultations, enforcement, court decisions, interpretive guidance,
// policy. Satellites carry deltas, not a second copy of the underlying analysis.
//
// Classification depends on TYPE plus, for bills, whether the entry has an
// outgoing `amends` relationship — so callers pass the entry's outgoing
// relationship kinds alongside its type.

import type { RelationshipKind } from "./constants";
import type { AnchorRole, SatelliteActivity } from "./types";

export type { AnchorRole };

// Types that are always anchors.
export const ANCHOR_TYPES = ["legislation", "regulation", "binding-guidance"] as const;

// Types that are always satellites.
export const SATELLITE_TYPES = [
  "amending-act",
  "consultation",
  "enforcement",
  "court-decision",
  "interpretive-guidance",
  "policy",
] as const;

// Relationship kinds (outgoing, i.e. this entry is the `from`) that tie a
// satellite to its anchor and satisfy the "must link to an anchor" rule.
export const SATELLITE_ANCHOR_KINDS: RelationshipKind[] = [
  "amends",
  "interprets",
  "implements",
  "subordinate_to",
];

// Soft-law guidance can legitimately stand alone (a standalone framework with no
// single principal instrument). For these types an absent anchor is allowed
// rather than flagged — see decision on grandfathering orphan satellites.
export const ANCHORLESS_OK_TYPES = ["interpretive-guidance", "policy", "consultation"] as const;

/**
 * Classify an entry as anchor or satellite. `outgoingKinds` are the kinds of
 * relationships where this entry is the dependent (`from`) side — only needed
 * to disambiguate bills (amends → satellite; otherwise anchor-in-embryo).
 */
export function classifyEntry(type: string, outgoingKinds: string[] = []): AnchorRole {
  if ((ANCHOR_TYPES as readonly string[]).includes(type)) return "anchor";
  if ((SATELLITE_TYPES as readonly string[]).includes(type)) return "satellite";
  if (type === "bill") {
    return outgoingKinds.includes("amends") ? "satellite" : "anchor";
  }
  // Unknown types default to anchor so they stay visible in the anchor-centric
  // list rather than silently disappearing under some other entry.
  return "anchor";
}

export function isAnchor(type: string, outgoingKinds: string[] = []): boolean {
  return classifyEntry(type, outgoingKinds) === "anchor";
}

/**
 * Whether a satellite is missing its anchor link and should be flagged. Soft
 * validation only — a warning, never a hard block (existing orphans are
 * grandfathered, standalone soft-law guidance is allowed to be anchorless).
 */
export function satelliteMissingAnchor(
  type: string,
  outgoingKinds: string[] = []
): boolean {
  if (classifyEntry(type, outgoingKinds) !== "satellite") return false;
  if ((ANCHORLESS_OK_TYPES as readonly string[]).includes(type)) return false;
  return !outgoingKinds.some((k) => SATELLITE_ANCHOR_KINDS.includes(k as RelationshipKind));
}

// A satellite as seen from its anchor, for the roll-up.
export interface AnchorSatellite {
  type: string;
  status: string;
  updatedAt: string;
  kind: string; // the relationship kind that ties it to the anchor
}

function coarseAgo(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1mo ago" : `${months}mo ago`;
}

/**
 * Summarise an anchor's satellites into the one-line activity string shown on
 * the anchor-centric list row, e.g. "1 bill in flight · guidance updated 3d ago".
 */
export function buildSatelliteActivity(satellites: AnchorSatellite[]): SatelliteActivity | null {
  if (satellites.length === 0) return null;

  const inFlightAmendments = satellites.filter(
    (s) => s.kind === "amends" && s.status !== "in_force" && s.status !== "repealed"
  ).length;
  const guidance = satellites.filter((s) => s.kind === "interprets");
  const latestUpdatedAt = satellites
    .map((s) => s.updatedAt)
    .sort()
    .at(-1) ?? null;

  const parts: string[] = [];
  if (inFlightAmendments > 0) {
    parts.push(`${inFlightAmendments} ${inFlightAmendments === 1 ? "amendment" : "amendments"} in flight`);
  }
  if (guidance.length > 0) {
    const latestGuidance = guidance.map((g) => g.updatedAt).sort().at(-1);
    parts.push(
      latestGuidance
        ? `guidance updated ${coarseAgo(latestGuidance)}`
        : `${guidance.length} guidance`
    );
  }
  if (parts.length === 0) {
    parts.push(`${satellites.length} satellite${satellites.length === 1 ? "" : "s"}`);
  }

  return {
    total: satellites.length,
    inFlightAmendments,
    guidanceCount: guidance.length,
    latestUpdatedAt,
    line: parts.join(" · "),
  };
}
