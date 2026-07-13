// Executes the lifecycle transitions that resolveLifecycle() computes — the
// server-side side-effects of an entry changing status (fold-in on commencement,
// staged/partial commencement, repeal-and-replace, lapse cleanup). Kept separate
// from the pure resolver so the route, the reconciler, and the reversal endpoint
// all drive the SAME behaviour.
//
// Provenance & reversibility (Gaps 5 & 8): every fold-in / supersede writes an
// `entry_changes` row on the affected parent whose `old_value` holds the id of
// the instrument that caused it. That id is the reversal key — `reverseFoldIn`
// undoes a commencement by finding those rows, so nothing here is destructive.

import { db } from "@/db";
import { entries, entryChanges, entryRelationships } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { now, generateId } from "@/lib/utils";
import { resolveLifecycle, type OutgoingRel, type LifecyclePlan } from "@/lib/anchor-model";
import { refreshSourcesForEntry } from "@/lib/source-refresher";

export interface LifecycleResult {
  plan: LifecyclePlan;
  foldedInto: string[];
  partialInto: string[];
  warnedStaleOn: string[];
  superseded: string[];
  clearedStaleOn: string[];
  archivedSelf: boolean;
}

function staleFor(principalSummaryDepth: string | null | undefined) {
  return !!principalSummaryDepth; // only stale a parent that HAS an analysis to invalidate
}

/**
 * Apply the lifecycle side-effects of an entry's status transition. Idempotent
 * enough for at-least-once callers: fold-in provenance rows are keyed by the
 * amendment id, and archive/stale writes are set-to-value (not toggles).
 */
export async function applyLifecycleTransition(opts: {
  entryId: string;
  entryShortName: string;
  /** the amendment's `whatItChanges` delta, if any — recorded as provenance on the parent. */
  entryWhatItChanges?: string | null;
  prevStatus: string;
  nextStatus: string;
  alreadyArchived: boolean;
}): Promise<LifecycleResult> {
  const { entryId, entryShortName, prevStatus, nextStatus, alreadyArchived } = opts;

  const outgoing: OutgoingRel[] = await db
    .select({ kind: entryRelationships.kind, toEntryId: entryRelationships.toEntryId })
    .from(entryRelationships)
    .where(eq(entryRelationships.fromEntryId, entryId));

  const plan = resolveLifecycle(prevStatus, nextStatus, outgoing);
  const ts = now();
  const delta = opts.entryWhatItChanges?.trim();

  // ── Fold-in: amends targets, full commencement (Gaps 3 & 4 — any number) ──
  const foldedInto: string[] = [];
  for (const targetId of plan.foldInto) {
    // Provenance record on the parent (old_value = amendment id, the reversal key).
    await db.insert(entryChanges).values({
      id: generateId(),
      entryId: targetId,
      fieldChanged: "amendment_commenced",
      oldValue: entryId,
      newValue: entryShortName,
      changeSummary: delta
        ? `${entryShortName} commenced and is now part of this instrument. Introduced: ${delta}`
        : `${entryShortName} commenced and is now part of this instrument.`,
      changedBy: "system",
      sourceUrl: null,
      sectionRef: null,
      sourceSnapshotId: null,
      changedAt: ts,
      status: "applied",
    });
    const [principal] = await db
      .select({ summaryDepth: entries.summaryDepth })
      .from(entries)
      .where(eq(entries.id, targetId));
    if (staleFor(principal?.summaryDepth)) {
      await db
        .update(entries)
        .set({
          analysisStaleReason: `Analysis predates ${entryShortName}, which is now in force. Regenerate for an up-to-date grounded analysis.`,
          updatedAt: ts,
        })
        .where(eq(entries.id, targetId));
    }
    // Re-fetch the parent's primary text; the refresher snapshots the outgoing
    // compilation as `amendment` before overwriting (point-in-time source).
    // SKIP_SOURCE_REFRESH suppresses the background fetch for bulk/offline runs
    // (migrations, verification) so they don't trigger N outbound requests.
    if (process.env.SKIP_SOURCE_REFRESH !== "1") {
      void refreshSourcesForEntry(targetId, "amendment").catch((err) =>
        console.error(`[lifecycle] source refresh failed for parent ${targetId}:`, err)
      );
    }
    foldedInto.push(targetId);
  }

  // ── Partial commencement (Gap 2) — flag, don't fold/archive ──────────────
  const partialInto: string[] = [];
  for (const targetId of plan.partialInto) {
    const [principal] = await db
      .select({ summaryDepth: entries.summaryDepth })
      .from(entries)
      .where(eq(entries.id, targetId));
    if (staleFor(principal?.summaryDepth)) {
      await db
        .update(entries)
        .set({
          analysisStaleReason: `Partially amended by ${entryShortName} (some provisions commenced). Review the changes now in force.`,
          updatedAt: ts,
        })
        .where(eq(entries.id, targetId));
    }
    partialInto.push(targetId);
  }

  // ── Passed early warning — flag stale, no fold ───────────────────────────
  const warnedStaleOn: string[] = [];
  for (const targetId of plan.warnStaleOn) {
    const [principal] = await db
      .select({ summaryDepth: entries.summaryDepth })
      .from(entries)
      .where(eq(entries.id, targetId));
    if (staleFor(principal?.summaryDepth)) {
      await db
        .update(entries)
        .set({
          analysisStaleReason: `Analysis predates ${entryShortName}, which has passed. Regenerate for an up-to-date grounded analysis.`,
          updatedAt: ts,
        })
        .where(eq(entries.id, targetId));
    }
    warnedStaleOn.push(targetId);
  }

  // ── Supersede (Gap 1: repeal-and-replace) ────────────────────────────────
  const superseded: string[] = [];
  for (const targetId of plan.supersede) {
    await db
      .update(entries)
      .set({ status: "superseded", archived: true, updatedAt: ts })
      .where(eq(entries.id, targetId));
    await db.insert(entryChanges).values({
      id: generateId(),
      entryId: targetId,
      fieldChanged: "superseded",
      oldValue: entryId,
      newValue: entryShortName,
      changeSummary: `Superseded by ${entryShortName}, now in force. Retained for history / point-in-time.`,
      changedBy: "system",
      sourceUrl: null,
      sectionRef: null,
      sourceSnapshotId: null,
      changedAt: ts,
      status: "applied",
    });
    superseded.push(targetId);
  }

  // ── Lapse cleanup (Gap 7) — undo staleness THIS entry imposed ────────────
  const clearedStaleOn: string[] = [];
  for (const targetId of plan.clearStaleOn) {
    const [p] = await db
      .select({ reason: entries.analysisStaleReason })
      .from(entries)
      .where(eq(entries.id, targetId));
    if (p?.reason && p.reason.includes(entryShortName)) {
      await db
        .update(entries)
        .set({ analysisStaleReason: null, updatedAt: ts })
        .where(eq(entries.id, targetId));
      clearedStaleOn.push(targetId);
    }
  }

  // ── Archive self ─────────────────────────────────────────────────────────
  let archivedSelf = false;
  if (plan.archiveSelf && !alreadyArchived) {
    await db.update(entries).set({ archived: true, updatedAt: ts }).where(eq(entries.id, entryId));
    archivedSelf = true;
  }

  return { plan, foldedInto, partialInto, warnedStaleOn, superseded, clearedStaleOn, archivedSelf };
}

/**
 * Reverse a fold-in / supersede caused by `amendmentId` on its parents (Gap 8).
 * Un-archives the amendment, removes the provenance rows it wrote, clears the
 * stale flags it set, and un-retires anything it superseded. Non-destructive by
 * construction — obligations were never hard-merged, only re-grounded, so
 * reversing leaves the parent's (now stale) analysis intact for regeneration.
 */
export async function reverseCommencement(amendmentId: string): Promise<{
  restoredParents: string[];
  restoredPredecessors: string[];
}> {
  const ts = now();
  const [amendment] = await db
    .select({ shortName: entries.shortName })
    .from(entries)
    .where(eq(entries.id, amendmentId));
  const amendmentName = amendment?.shortName ?? "";

  // Provenance rows this amendment wrote (old_value = amendmentId).
  const provRows = await db
    .select({ id: entryChanges.id, entryId: entryChanges.entryId, fieldChanged: entryChanges.fieldChanged })
    .from(entryChanges)
    .where(eq(entryChanges.oldValue, amendmentId));

  const restoredParents: string[] = [];
  const restoredPredecessors: string[] = [];
  for (const row of provRows) {
    if (row.fieldChanged === "amendment_commenced") {
      // Clear the stale flag we set on the parent (only if still ours).
      const [p] = await db
        .select({ reason: entries.analysisStaleReason })
        .from(entries)
        .where(eq(entries.id, row.entryId));
      if (p?.reason && p.reason.includes(amendmentName)) {
        await db.update(entries).set({ analysisStaleReason: null, updatedAt: ts }).where(eq(entries.id, row.entryId));
      }
      restoredParents.push(row.entryId);
    } else if (row.fieldChanged === "superseded") {
      // Un-retire the predecessor.
      await db
        .update(entries)
        .set({ status: "in_force", archived: false, updatedAt: ts })
        .where(eq(entries.id, row.entryId));
      restoredPredecessors.push(row.entryId);
    }
    await db.delete(entryChanges).where(eq(entryChanges.id, row.id));
  }

  // Un-archive the amendment itself and drop it back to `passed`.
  await db
    .update(entries)
    .set({ archived: false, status: "passed", updatedAt: ts })
    .where(eq(entries.id, amendmentId));

  return { restoredParents, restoredPredecessors };
}
