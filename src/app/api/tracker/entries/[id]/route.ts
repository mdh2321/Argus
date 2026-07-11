import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { entries, entryChanges, entryRelationships } from "@/db/schema";
import { eq, desc, or, inArray, and } from "drizzle-orm";
import { now, toJsonString, generateId } from "@/lib/utils";
import { serializeEntry, logChanges, syncDeadlines, computeNextKeyDate } from "@/lib/entry-helpers";
import { normalizeSourceUrls } from "@/lib/source-tiers";
import { classifyEntry, satelliteMissingAnchor } from "@/lib/anchor-model";
import { refreshSourcesForEntry } from "@/lib/source-refresher";
import type { RelatedEntryWithKind } from "@/lib/types";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const [entry] = await db.select().from(entries).where(eq(entries.id, id));

  if (!entry) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  }

  // Applied change history — excludes AI proposals (status='proposed') and
  // dismissed ones so the timeline shows only changes that actually happened.
  const changes = await db
    .select()
    .from(entryChanges)
    .where(and(eq(entryChanges.entryId, id), eq(entryChanges.status, "applied")))
    .orderBy(desc(entryChanges.changedAt));

  // Pending AI-proposed changes (A1) awaiting approve/dismiss on this entry.
  const proposedChanges = await db
    .select()
    .from(entryChanges)
    .where(and(eq(entryChanges.entryId, id), eq(entryChanges.status, "proposed")))
    .orderBy(desc(entryChanges.changedAt));

  // Fetch parent entry if this is a child (legacy parent_entry_id field).
  // Kept populated for backwards compatibility while the UI transitions to
  // the typed relationship sections below.
  let parentEntry = null;
  if (entry.parentEntryId) {
    const [parent] = await db.select({
      id: entries.id,
      shortName: entries.shortName,
      type: entries.type,
      status: entries.status,
      jurisdiction: entries.jurisdiction,
      impactScore: entries.impactScore,
      nextKeyDate: entries.nextKeyDate,
      createdAt: entries.createdAt,
    }).from(entries).where(eq(entries.id, entry.parentEntryId));
    parentEntry = parent || null;
  }

  // Fetch child entries if this is a parent (legacy parent_entry_id).
  const childEntries = await db.select({
    id: entries.id,
    shortName: entries.shortName,
    type: entries.type,
    status: entries.status,
    jurisdiction: entries.jurisdiction,
    impactScore: entries.impactScore,
    nextKeyDate: entries.nextKeyDate,
    createdAt: entries.createdAt,
  }).from(entries).where(eq(entries.parentEntryId, id)).orderBy(entries.createdAt);

  // ── Typed relationships ─────────────────────────────────────────────────
  //
  // Pull every relationship row that touches this entry (in either direction)
  // and join the related entry's summary fields. Group by (kind, direction)
  // so the detail page can render a section per group without re-querying.
  const rels = await db
    .select()
    .from(entryRelationships)
    .where(
      or(eq(entryRelationships.fromEntryId, id), eq(entryRelationships.toEntryId, id))
    );

  const relatedIds = Array.from(
    new Set(rels.flatMap((r) => [r.fromEntryId, r.toEntryId]).filter((rid) => rid !== id))
  );

  const relatedEntryRows = relatedIds.length
    ? await db
        .select({
          id: entries.id,
          shortName: entries.shortName,
          type: entries.type,
          status: entries.status,
          jurisdiction: entries.jurisdiction,
          impactScore: entries.impactScore,
          nextKeyDate: entries.nextKeyDate,
          createdAt: entries.createdAt,
          archived: entries.archived,
        })
        .from(entries)
        .where(inArray(entries.id, relatedIds))
    : [];

  const relatedById = new Map(relatedEntryRows.map((r) => [r.id, r]));

  const relatedSubordinates: RelatedEntryWithKind[] = [];
  const relatedGuidance: RelatedEntryWithKind[] = [];
  const amendmentHistory: RelatedEntryWithKind[] = [];
  const inFlightAmendments: RelatedEntryWithKind[] = [];
  const supersedes: RelatedEntryWithKind[] = [];
  const supersededBy: RelatedEntryWithKind[] = [];
  const parentInstruments: RelatedEntryWithKind[] = [];

  for (const rel of rels) {
    const direction: "outgoing" | "incoming" = rel.fromEntryId === id ? "outgoing" : "incoming";
    const otherId = direction === "outgoing" ? rel.toEntryId : rel.fromEntryId;
    const other = relatedById.get(otherId);
    if (!other) continue; // orphaned relationship — skip silently

    const item: RelatedEntryWithKind = {
      id: other.id,
      shortName: other.shortName,
      type: other.type,
      status: other.status,
      jurisdiction: other.jurisdiction,
      impactScore: other.impactScore,
      nextKeyDate: other.nextKeyDate,
      createdAt: other.createdAt,
      kind: rel.kind,
      direction,
    };

    if (direction === "incoming") {
      switch (rel.kind) {
        case "subordinate_to":
          relatedSubordinates.push(item);
          break;
        case "interprets":
          relatedGuidance.push(item);
          break;
        case "amends": {
          // History = the amending act has actually taken effect; in-flight = otherwise.
          const inForce = other.status === "in_force" || other.status === "amended" || !!other.archived;
          (inForce ? amendmentHistory : inFlightAmendments).push(item);
          break;
        }
        case "supersedes":
          supersededBy.push(item); // someone else supersedes me → I was superseded
          break;
        // implements / references → fall through (could surface in a generic
        // "Related" section later; not split out yet to keep noise down).
      }
    } else {
      // outgoing — what this entry depends on / refers to
      switch (rel.kind) {
        case "subordinate_to":
        case "amends":
        case "interprets":
        case "implements":
          parentInstruments.push(item);
          break;
        case "supersedes":
          supersedes.push(item); // I supersede some older entry
          break;
      }
    }
  }

  const sortByDate = (a: RelatedEntryWithKind, b: RelatedEntryWithKind) =>
    (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
  relatedSubordinates.sort(sortByDate);
  relatedGuidance.sort(sortByDate);
  amendmentHistory.sort(sortByDate);
  inFlightAmendments.sort(sortByDate);
  supersedes.sort(sortByDate);
  supersededBy.sort(sortByDate);
  parentInstruments.sort(sortByDate);

  // Anchor/satellite classification + soft validation (§2.1). Outgoing kinds
  // are the relationships where this entry is the dependent (`from`) side.
  const outgoingKinds = rels
    .filter((r) => r.fromEntryId === id)
    .map((r) => r.kind);
  const anchorRole = classifyEntry(entry.type, outgoingKinds);

  return NextResponse.json({
    entry: {
      ...serializeEntry(entry),
      anchorRole,
      missingAnchor: satelliteMissingAnchor(entry.type, outgoingKinds),
    },
    changes,
    proposedChanges,
    parentEntry,
    childEntries,
    relatedSubordinates,
    relatedGuidance,
    amendmentHistory,
    inFlightAmendments,
    supersedes,
    supersededBy,
    parentInstruments,
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();

  const [existing] = await db.select().from(entries).where(eq(entries.id, id));
  if (!existing) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  }

  // Build the update object
  const updates: Record<string, unknown> = {};
  const allowedFields = [
    "jurisdiction", "category", "type", "status", "shortName", "fullName",
    "formalCitation",
    "summary", "applicability", "keyCriteria", "whyItMatters", "complianceImplications",
    "impactOnUs", "impactOnCustomers",
    "exemptions", "penalties",
    "maxPenaltyValue", "maxPenaltyCurrency", "impactScore", "regulator",
    "notes", "flagged", "openQuestions", "relatedContext", "tags", "parentEntryId",
  ];

  for (const field of allowedFields) {
    if (field in body) {
      updates[field] = body[field];
    }
  }

  // Handle JSON fields
  if (body.keyDates !== undefined) {
    updates.keyDates = toJsonString(body.keyDates);
    updates.nextKeyDate = computeNextKeyDate(updates.keyDates as string);
  }
  if (body.sourceUrls !== undefined) {
    const normalized = normalizeSourceUrls(body.sourceUrls);
    updates.sourceUrls = normalized ? toJsonString(normalized) : null;
  }
  if (body.sectionConfidence !== undefined) {
    updates.sectionConfidence = body.sectionConfidence ? toJsonString(body.sectionConfidence) : null;
  }
  if (body.sectionClaims !== undefined) {
    updates.sectionClaims = body.sectionClaims ? toJsonString(body.sectionClaims) : null;
  }
  if (body.relatedEntries !== undefined) {
    updates.relatedEntries = toJsonString(body.relatedEntries);
  }
  if (body.tags !== undefined) {
    updates.tags = toJsonString(body.tags);
  }

  updates.updatedAt = now();

  // Log changes
  await logChanges(id, existing, body, body._changedBy || "manual");

  // Apply update
  await db.update(entries).set(updates).where(eq(entries.id, id));

  // Sync deadlines if dates changed
  if (body.keyDates !== undefined) {
    await syncDeadlines(id, updates.keyDates as string);
  }

  const finalType = (updates.type ?? existing.type) as string;
  const finalStatus = (updates.status ?? existing.status) as string;
  const wasInForce = existing.status === "in_force";
  const isAmendingAct = finalType === "amending-act";
  const amendingShortName = (updates.shortName ?? existing.shortName) as string;

  // ── A2: amendment staleness propagation ─────────────────────────────────
  // When an amending instrument transitions to `passed` or `in_force`, the
  // principals it amends now have analysis that predates it. Flag each
  // principal that has an analysis so the reader knows to regenerate.
  const becameActive =
    (finalStatus === "passed" || finalStatus === "in_force") &&
    existing.status !== finalStatus;
  if (becameActive) {
    const amendsTargets = await db
      .select({ toEntryId: entryRelationships.toEntryId })
      .from(entryRelationships)
      .where(
        and(eq(entryRelationships.fromEntryId, id), eq(entryRelationships.kind, "amends"))
      );
    if (amendsTargets.length > 0) {
      const staleReason = `Analysis predates ${amendingShortName}, which ${
        finalStatus === "in_force" ? "is now in force" : "has passed"
      }. Regenerate for an up-to-date grounded analysis.`;
      const staleTs = now();
      for (const t of amendsTargets) {
        // Only stale a principal that actually has an analysis to invalidate.
        const [principal] = await db
          .select({ summaryDepth: entries.summaryDepth })
          .from(entries)
          .where(eq(entries.id, t.toEntryId));
        if (principal?.summaryDepth) {
          await db
            .update(entries)
            .set({ analysisStaleReason: staleReason, updatedAt: staleTs })
            .where(eq(entries.id, t.toEntryId));
        }

        // §2.4 — on actual commencement, the anchor's compilation is now out of
        // date. Re-fetch its primary text; the refresher snapshots the outgoing
        // compilation (tagged `amendment`) before overwriting, preserving the
        // pre-amendment text on the anchor's compilation timeline. Fire-and-
        // forget — the fetch is slow and must not block the PATCH response. The
        // staleness flag above + the entry's "Re-ground analysis" action
        // complete the loop.
        if (finalStatus === "in_force") {
          void refreshSourcesForEntry(t.toEntryId, "amendment").catch((err) =>
            console.error(
              `[amendment-commence] source refresh failed for anchor ${t.toEntryId}:`,
              err
            )
          );
        }
      }
    }
  }

  // ── Lifecycle: amending-act commencement ────────────────────────────────
  // When an amending act flips to `in_force`, its operative effect is folded
  // into the parent. We auto-archive it (so it disappears from the active
  // tracker list) and write an EntryChange on each `amends` target so the
  // parent's amendment-history timeline records the commencement.
  if (isAmendingAct && finalStatus === "in_force" && !wasInForce && !existing.archived) {
    const archiveTimestamp = now();
    await db
      .update(entries)
      .set({ archived: true, updatedAt: archiveTimestamp })
      .where(eq(entries.id, id));

    const amendsRels = await db
      .select({ toEntryId: entryRelationships.toEntryId })
      .from(entryRelationships)
      .where(
        and(
          eq(entryRelationships.fromEntryId, id),
          eq(entryRelationships.kind, "amends")
        )
      );

    for (const rel of amendsRels) {
      await db.insert(entryChanges).values({
        id: generateId(),
        entryId: rel.toEntryId,
        fieldChanged: "amendment_commenced",
        oldValue: null,
        newValue: amendingShortName,
        changeSummary: `${amendingShortName} commenced and is now part of this Act`,
        changedBy: "system",
        sourceUrl: null,
        sectionRef: null,
        sourceSnapshotId: null,
        changedAt: archiveTimestamp,
      });
    }
  }

  const [updated] = await db.select().from(entries).where(eq(entries.id, id));
  return NextResponse.json(serializeEntry(updated));
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const [existing] = await db.select().from(entries).where(eq(entries.id, id));
  if (!existing) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  }

  // Soft delete
  await db.update(entries).set({ archived: true, updatedAt: now() }).where(eq(entries.id, id));

  return NextResponse.json({ success: true });
}
