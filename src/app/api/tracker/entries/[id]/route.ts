import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { entries, entryChanges, entryRelationships } from "@/db/schema";
import { eq, desc, or, inArray, and } from "drizzle-orm";
import { now, toJsonString } from "@/lib/utils";
import { serializeEntry, logChanges, syncDeadlines, computeNextKeyDate } from "@/lib/entry-helpers";
import { normalizeSourceUrls } from "@/lib/source-tiers";
import { classifyEntry, satelliteMissingAnchor, obligationDisposition } from "@/lib/anchor-model";
import { applyLifecycleTransition } from "@/lib/lifecycle";
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
  // Peer instruments — `references` cross-links between independent anchors (no
  // hierarchy). Shown together regardless of direction.
  const relatedInstruments: RelatedEntryWithKind[] = [];

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
        case "implements": // delegated instrument made under this one
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
        case "references":
          relatedInstruments.push(item);
          break;
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
        case "references":
          relatedInstruments.push(item);
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
  relatedInstruments.sort(sortByDate);

  // Anchor/satellite classification + soft validation (§2.1). Outgoing kinds
  // are the relationships where this entry is the dependent (`from`) side.
  const outgoingKinds = rels
    .filter((r) => r.fromEntryId === id)
    .map((r) => r.kind);
  const anchorRole = classifyEntry(entry.type, outgoingKinds);
  // Reversible when this entry is an archived amendment/successor — its
  // commencement folded into / retired something and can be undone.
  const canReverseCommencement =
    !!entry.archived &&
    outgoingKinds.some((k) => k === "amends" || k === "supersedes");

  return NextResponse.json({
    entry: {
      ...serializeEntry(entry),
      anchorRole,
      missingAnchor: satelliteMissingAnchor(entry.type, outgoingKinds),
      obligationDisposition: obligationDisposition(entry.type, entry.authorityLevel, outgoingKinds),
      canReverseCommencement,
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
    relatedInstruments,
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

  const finalStatus = (updates.status ?? existing.status) as string;

  // ── Lifecycle transitions ────────────────────────────────────────────────
  // A status change can mean: an amendment folds into its parent(s) on full
  // commencement (Gaps 3/4), commences in stages (Gap 2), replaces a predecessor
  // (Gap 1), or lapses before force (Gap 7). resolveLifecycle() decides which;
  // applyLifecycleTransition() runs the side-effects (stale flags, provenance
  // rows, archive, source re-fetch). See src/lib/lifecycle.ts.
  if (finalStatus !== existing.status) {
    await applyLifecycleTransition({
      entryId: id,
      entryShortName: (updates.shortName ?? existing.shortName) as string,
      entryWhatItChanges: (updates.whatItChanges ?? existing.whatItChanges) as string | null,
      prevStatus: existing.status as string,
      nextStatus: finalStatus,
      alreadyArchived: !!existing.archived,
    });
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
