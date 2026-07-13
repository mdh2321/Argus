// Anchor / satellite model — the single source of truth for how tracker entries
// relate, carry obligations, and move through their lifecycle. Pure & client-safe
// (no DB imports) so the list, entry page, pipeline, and API routes all classify
// identically.
//
// TWO INDEPENDENT AXES (the July 2026 model):
//
//   1. Obligation disposition — does this entry carry its OWN obligations, does
//      it INHERIT them into a parent (an amendment folds in), or is it purely
//      informative (guidance, enforcement, a peer cross-reference)?  Driven by
//      authority level + relationship, NOT by the display bucket.
//
//   2. Display role (anchor vs satellite) — what nests under what. A "satellite"
//      is only a navigation/layout choice; it says nothing about obligations.
//
// Relationship kinds (see constants.RELATIONSHIP_KINDS) group by SEMANTICS:
//
//   amends        (FOLD)        transient change; folds into its parent on full
//                               commencement, then survives as history + source.
//   subordinate_to / implements (DELEGATED) standing instrument made under a
//                               parent; permanent nested satellite; own
//                               obligations IF binding.
//   interprets    (INFORMATIVE) guidance/commentary about a parent; no own
//                               obligations; never folds.
//   supersedes    (SUPERSEDE)   this entry REPLACES an older one; the newer entry
//                               is itself an anchor, the older is retired.
//   references    (PEER)        soft cross-reference between independent anchors;
//                               no hierarchy, never demotes to a satellite.

import type { RelationshipKind, AuthorityLevel } from "./constants";
import { TYPE_DEFAULT_AUTHORITY } from "./constants";
import type { AnchorRole, SatelliteActivity } from "./types";

export type { AnchorRole };

// Types that are always anchors (principal compliance surfaces).
export const ANCHOR_TYPES = ["legislation", "regulation", "binding-guidance"] as const;

// Types that are always satellites by their nature.
export const SATELLITE_TYPES = [
  "amending-act",
  "consultation",
  "enforcement",
  "court-decision",
  "interpretive-guidance",
  "policy",
] as const;

// ── Relationship semantic groups ───────────────────────────────────────────
// A relationship kind means one of five things. Everything downstream keys off
// these groups rather than hard-coding individual kinds, so adding a kind is a
// one-line change here.
export const FOLD_KINDS: RelationshipKind[] = ["amends"];
export const DELEGATED_KINDS: RelationshipKind[] = ["subordinate_to", "implements"];
export const INFORMATIVE_KINDS: RelationshipKind[] = ["interprets"];
export const SUPERSEDE_KINDS: RelationshipKind[] = ["supersedes"];
export const PEER_KINDS: RelationshipKind[] = ["references"];

// Kinds that make an entry a satellite of the thing it points to (i.e. it nests
// under a parent). `supersedes` and `references` are deliberately excluded — a
// superseding instrument is the new anchor, a reference is a peer.
export const SATELLITE_ANCHOR_KINDS: RelationshipKind[] = [
  ...FOLD_KINDS,
  ...DELEGATED_KINDS,
  ...INFORMATIVE_KINDS,
];

// Soft-law guidance can legitimately stand alone (a framework with no single
// principal instrument). For these types an absent anchor is allowed rather than
// flagged.
export const ANCHORLESS_OK_TYPES = ["interpretive-guidance", "policy", "consultation"] as const;

function hasKind(outgoing: string[], group: RelationshipKind[]): boolean {
  return outgoing.some((k) => (group as string[]).includes(k));
}

/**
 * Display classification: does this entry render as a top-level anchor or nested
 * under a parent? Relationship-aware — an entry that amends / is made under /
 * interprets another nests under it, regardless of its own type. `supersedes`
 * and `references` links never demote (the entry stays an anchor).
 */
export function classifyEntry(type: string, outgoingKinds: string[] = []): AnchorRole {
  if (hasKind(outgoingKinds, SATELLITE_ANCHOR_KINDS)) return "satellite";
  if ((ANCHOR_TYPES as readonly string[]).includes(type)) return "anchor";
  if ((SATELLITE_TYPES as readonly string[]).includes(type)) return "satellite";
  // A bill that amends is caught above; a bill with no amends link is an
  // anchor-in-embryo (it becomes the principal instrument on commencement).
  if (type === "bill") return "anchor";
  // Unknown types default to anchor so they stay visible rather than vanishing.
  return "anchor";
}

export function isAnchor(type: string, outgoingKinds: string[] = []): boolean {
  return classifyEntry(type, outgoingKinds) === "anchor";
}

// ── Axis 1: obligation disposition ─────────────────────────────────────────
export type ObligationDisposition =
  | "own" // carries its own obligations (principal Act, binding delegated instrument)
  | "inherited" // obligations fold into a parent (an amending instrument)
  | "none"; // informative only — guidance, enforcement, court, consultation, peer

/**
 * Does this entry carry obligations, and whose?  (Gap 6: binding-vs-non-binding.)
 *
 *   amends link            → "inherited"  (its obligations live in the parent)
 *   binding authority      → "own"        (principal Act OR binding delegated legislation)
 *   anything else          → "none"       (expected/interpretive/informational is advisory)
 *
 * Authority level is the decisive signal — a binding registered Code owns its
 * obligations; non-binding guidance made under the same Act does not, even
 * though both nest under the anchor.
 */
export function obligationDisposition(
  type: string,
  authorityLevel: string | null | undefined,
  outgoingKinds: string[] = []
): ObligationDisposition {
  if (hasKind(outgoingKinds, FOLD_KINDS)) return "inherited";
  const authority = (authorityLevel ?? TYPE_DEFAULT_AUTHORITY[type] ?? "informational") as AuthorityLevel;
  return authority === "binding" ? "own" : "none";
}

// ── Satellite display grouping (for the anchor page zones) ──────────────────
export type SatelliteGroup = "amendment" | "delegated" | "guidance" | "superseded" | "related";

/** Which zone of the anchor page a satellite relationship belongs in. */
export function satelliteGroup(kind: string): SatelliteGroup {
  if ((FOLD_KINDS as string[]).includes(kind)) return "amendment";
  if ((DELEGATED_KINDS as string[]).includes(kind)) return "delegated";
  if ((INFORMATIVE_KINDS as string[]).includes(kind)) return "guidance";
  if ((SUPERSEDE_KINDS as string[]).includes(kind)) return "superseded";
  return "related";
}

// ── Soft validation ─────────────────────────────────────────────────────────
/**
 * Whether a satellite is missing its anchor link and should be flagged. Soft
 * validation only — advisory, never a hard block. Standalone soft-law guidance
 * is allowed to be anchorless.
 */
export function satelliteMissingAnchor(type: string, outgoingKinds: string[] = []): boolean {
  if (classifyEntry(type, outgoingKinds) !== "satellite") return false;
  if ((ANCHORLESS_OK_TYPES as readonly string[]).includes(type)) return false;
  return !hasKind(outgoingKinds, SATELLITE_ANCHOR_KINDS);
}

// ── Axis 2 lifecycle: what happens on a status transition ────────────────────
// Commencement is not a single instant. An amendment can commence in STAGES
// (Gap 2), an omnibus amends MANY parents at once (Gap 4), a new instrument can
// SUPERSEDE an old one (Gap 1), and an in-flight item can LAPSE (Gap 7). The
// resolver turns a status transition + the entry's outgoing relationships into a
// concrete plan the route executes. Pure and exhaustively unit-testable.

export interface OutgoingRel {
  kind: string;
  toEntryId: string;
}

export interface LifecyclePlan {
  /** amends targets to FULLY fold into (archive self + merge). Gap 3/4: any number. */
  foldInto: string[];
  /** amends targets to flag as PARTIALLY amended — entry stays live. Gap 2. */
  partialInto: string[];
  /** amends targets to flag stale as an EARLY WARNING (passed, not yet in force). */
  warnStaleOn: string[];
  /** predecessors this entry replaces; retire them. Gap 1. */
  supersede: string[];
  /** targets whose stale flag should be CLEARED because this item lapsed. Gap 7. */
  clearStaleOn: string[];
  /** archive this entry as part of the transition. */
  archiveSelf: boolean;
  /** human-readable summary of what the plan does (empty string = no-op). */
  reason: string;
}

const EMPTY_PLAN: LifecyclePlan = {
  foldInto: [],
  partialInto: [],
  warnStaleOn: [],
  supersede: [],
  clearStaleOn: [],
  archiveSelf: false,
  reason: "",
};

// Statuses that mean "this item is done in the pre-force pipeline and will never
// commence" — folding/staleness it caused must be undone.
const LAPSED_STATUSES = new Set(["lapsed", "repealed"]);

/**
 * Resolve a status transition into a lifecycle plan.
 *
 * @param prevStatus  status before the change
 * @param nextStatus  status after the change
 * @param outgoing    this entry's outgoing relationships (from = this entry)
 */
export function resolveLifecycle(
  prevStatus: string,
  nextStatus: string,
  outgoing: OutgoingRel[]
): LifecyclePlan {
  if (prevStatus === nextStatus) return EMPTY_PLAN;

  const amendsTargets = outgoing.filter((r) => (FOLD_KINDS as string[]).includes(r.kind)).map((r) => r.toEntryId);
  const supersedeTargets = outgoing.filter((r) => (SUPERSEDE_KINDS as string[]).includes(r.kind)).map((r) => r.toEntryId);

  // Fully commenced → fold every amends target in, retire every superseded
  // predecessor, and archive self if it actually folds/supersedes.
  if (nextStatus === "in_force") {
    const folds = amendsTargets.length > 0;
    const supers = supersedeTargets.length > 0;
    const parts: string[] = [];
    if (folds) parts.push(`folds into ${amendsTargets.length} instrument(s)`);
    if (supers) parts.push(`supersedes ${supersedeTargets.length} instrument(s)`);
    return {
      ...EMPTY_PLAN,
      foldInto: amendsTargets,
      supersede: supersedeTargets,
      // Archive self only when it truly resolves into something else. A plain
      // principal Act commencing (no amends/supersedes) stays live.
      archiveSelf: folds || supers,
      reason: parts.length ? `Commenced — ${parts.join("; ")}.` : "",
    };
  }

  // Passed but not yet commenced — early warning only. Flag the parents whose
  // analysis now predates a passed-but-not-in-force amendment; no fold, no
  // archive (the change hasn't taken legal effect yet).
  if (nextStatus === "passed" && amendsTargets.length > 0) {
    return {
      ...EMPTY_PLAN,
      warnStaleOn: amendsTargets,
      reason: `Passed — ${amendsTargets.length} instrument(s) flagged: analysis predates a passed amendment.`,
    };
  }

  // Partial commencement (Gap 2) — flag parents "partially amended", but the
  // amendment stays live because some provisions have not yet commenced.
  if (nextStatus === "partially_in_force" && amendsTargets.length > 0) {
    return {
      ...EMPTY_PLAN,
      partialInto: amendsTargets,
      reason: `Partially commenced — ${amendsTargets.length} instrument(s) partially amended; entry stays live until full commencement.`,
    };
  }

  // Lapsed / withdrawn / repealed before force (Gap 7) — this item will never
  // commence, so undo any staleness it imposed on the parents it would have
  // amended, and archive it.
  if (LAPSED_STATUSES.has(nextStatus) && !prevWasInForce(prevStatus)) {
    const affected = [...new Set([...amendsTargets, ...supersedeTargets])];
    return {
      ...EMPTY_PLAN,
      clearStaleOn: affected,
      archiveSelf: true,
      reason: affected.length
        ? `Lapsed — cleared pending change on ${affected.length} instrument(s).`
        : "Lapsed.",
    };
  }

  return EMPTY_PLAN;
}

function prevWasInForce(status: string): boolean {
  return status === "in_force" || status === "partially_in_force" || status === "amended";
}

// ── Anchor roll-up (anchor-centric list row) ─────────────────────────────────
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
 * the anchor-centric list row, e.g. "1 amendment in flight · 2 made under · guidance updated 3d ago".
 */
export function buildSatelliteActivity(satellites: AnchorSatellite[]): SatelliteActivity | null {
  if (satellites.length === 0) return null;

  const inFlightAmendments = satellites.filter(
    (s) => (FOLD_KINDS as string[]).includes(s.kind) && s.status !== "in_force" && s.status !== "repealed"
  ).length;
  const delegated = satellites.filter((s) => (DELEGATED_KINDS as string[]).includes(s.kind));
  const guidance = satellites.filter((s) => (INFORMATIVE_KINDS as string[]).includes(s.kind));
  const latestUpdatedAt = satellites.map((s) => s.updatedAt).sort().at(-1) ?? null;

  const parts: string[] = [];
  if (inFlightAmendments > 0) {
    parts.push(`${inFlightAmendments} amendment${inFlightAmendments === 1 ? "" : "s"} in flight`);
  }
  if (delegated.length > 0) {
    parts.push(`${delegated.length} made under`);
  }
  if (guidance.length > 0) {
    const latestGuidance = guidance.map((g) => g.updatedAt).sort().at(-1);
    parts.push(latestGuidance ? `guidance updated ${coarseAgo(latestGuidance)}` : `${guidance.length} guidance`);
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

// ── Canonical instrument identity (Gap 9: duplicate detection) ───────────────
// Not the full instrument registry (deferred Phase 4) — a lightweight key that
// normalises a formal citation / name so two entries for the SAME real-world
// instrument can be detected. Deliberately CONSERVATIVE: it keeps the
// distinguishing features (jurisdiction + year + substantive words) and only
// strips formatting noise (casing, punctuation, parentheticals, a leading
// jurisdiction token, possessives). Over-stripping would collapse genuinely
// different Acts ("AU Privacy Act 1988" vs "NZ Privacy Act 2020").
const JURISDICTION_CODES = ["au", "nz", "sg", "jp", "hk", "in", "ph"];
// Parentheticals that are pure noise (jurisdiction / status markers) and can be
// dropped. A parenthetical NOT on this list (e.g. "(Tranche 1 Reforms)") carries
// distinguishing signal and is kept, so an amendment isn't merged with its Act.
const NOISE_PARENTHETICALS = new Set([
  "cth", "commonwealth", "australia", "new zealand", "singapore", "japan",
  "hong kong", "india", "philippines", "eu", "uk", "us",
  ...JURISDICTION_CODES,
  "proposed", "draft", "bill", "repealed", "consultation", "no",
]);

export function canonicalInstrumentKey(input: {
  formalCitation?: string | null;
  shortName?: string | null;
  jurisdiction?: string | null;
}): string {
  const raw = (input.formalCitation || input.shortName || "").toLowerCase();
  if (!raw) return "";
  const jur = (input.jurisdiction || "").toLowerCase().slice(0, 2);
  const core = raw
    .replace(/\(([^)]*)\)/g, (_m, inner) =>
      NOISE_PARENTHETICALS.has(String(inner).trim()) ? " " : ` ${inner} `
    )
    .replace(new RegExp(`^\\s*(${JURISDICTION_CODES.join("|")})\\b[\\s\\-–—:]*`, "i"), " ") // leading jurisdiction token
    .replace(/['’]s?\b/g, "") // possessives: children's → children
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return core ? `${jur}|${core}` : "";
}
