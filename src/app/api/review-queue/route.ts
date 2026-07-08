import { NextResponse } from "next/server";
import { db } from "@/db";
import { entries, entryChanges, gapSuggestions } from "@/db/schema";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";

// B1 — the review queue, decisions only. AI-proposed entry changes (A1) carry
// enough fields for the dashboard to approve/dismiss inline; stale analyses
// (A2) link to their entry where re-run lives. Ungrounded entries and gap
// suggestions are housekeeping rather than decisions, so they ship as bare
// counts for a demoted pointer line — resolved on Tracker and Digest
// respectively. No generation happens here; it's a thin query layer.

const FIELD_LABELS: Record<string, string> = {
  status: "Status",
  key_dates: "Key dates",
  regulator: "Regulator",
  penalties: "Penalties",
};

interface ProposedItem {
  changeId: string;
  entryId: string;
  entryShortName: string;
  field: string;
  fieldLabel: string;
  oldValue: string | null;
  newValue: string | null;
  changeSummary: string | null;
}

interface StaleItem {
  entryId: string;
  entryShortName: string;
  reason: string;
}

export async function GET() {
  // 1. Proposed changes (A1) — awaiting approve/dismiss.
  const proposedRows = await db
    .select({
      changeId: entryChanges.id,
      entryId: entryChanges.entryId,
      entryShortName: entries.shortName,
      field: entryChanges.fieldChanged,
      oldValue: entryChanges.oldValue,
      newValue: entryChanges.newValue,
      changeSummary: entryChanges.changeSummary,
    })
    .from(entryChanges)
    .innerJoin(entries, eq(entryChanges.entryId, entries.id))
    .where(eq(entryChanges.status, "proposed"))
    .orderBy(desc(entryChanges.changedAt));

  const proposed: ProposedItem[] = proposedRows.map((p) => ({
    ...p,
    fieldLabel: FIELD_LABELS[p.field] ?? p.field,
  }));

  // 2. Stale analyses (A2) — analysis predates a material change.
  const staleRows = await db
    .select({
      entryId: entries.id,
      entryShortName: entries.shortName,
      reason: entries.analysisStaleReason,
    })
    .from(entries)
    .where(and(isNotNull(entries.analysisStaleReason), eq(entries.archived, false)))
    .orderBy(desc(entries.updatedAt));

  const stale: StaleItem[] = staleRows.map((s) => ({
    ...s,
    reason: s.reason ?? "Analysis may be out of date",
  }));

  // 3. Housekeeping counts for the demoted pointer line.
  const [preliminaryCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(entries)
    .where(and(eq(entries.summaryDepth, "preliminary"), eq(entries.archived, false)));
  const [gapCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(gapSuggestions)
    .where(eq(gapSuggestions.status, "pending"));

  return NextResponse.json({
    total: proposed.length + stale.length,
    proposed,
    stale,
    related: {
      preliminaryCount: preliminaryCount.count,
      gapCount: gapCount.count,
    },
  });
}
