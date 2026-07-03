import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { knowledgeItems, knowledgeClaims, entries } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { serializeKnowledgeItem } from "@/lib/knowledge-ai";
import { now } from "@/lib/utils";
import type { KnowledgeItemWithClaims, KnowledgeClaim, GroundingType, KnowledgeConfidence } from "@/lib/types";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const [row] = await db
    .select()
    .from(knowledgeItems)
    .where(eq(knowledgeItems.id, id));

  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const item = serializeKnowledgeItem(row);

  // Get claims
  const claimRows = await db
    .select()
    .from(knowledgeClaims)
    .where(eq(knowledgeClaims.knowledgeItemId, id));

  const claims: KnowledgeClaim[] = claimRows.map((c) => ({
    id: c.id,
    knowledgeItemId: c.knowledgeItemId,
    claimText: c.claimText,
    sourceDocId: c.sourceDocId,
    sourceEntryId: c.sourceEntryId,
    sourceSection: c.sourceSection,
    groundingType: c.groundingType as GroundingType,
    confidence: c.confidence as KnowledgeConfidence,
    disputed: c.disputed || false,
    disputeNote: c.disputeNote,
    createdAt: c.createdAt,
  }));

  // Get source entry names for display
  const entryIds = item.sourceEntryIds || [];
  let sourceEntries: { id: string; shortName: string; jurisdiction: string }[] = [];
  if (entryIds.length > 0) {
    const entryRows = await db
      .select({ id: entries.id, shortName: entries.shortName, jurisdiction: entries.jurisdiction })
      .from(entries)
      .where(inArray(entries.id, entryIds));
    sourceEntries = entryRows;
  }

  const result: KnowledgeItemWithClaims = {
    ...item,
    claims,
    sourceEntries,
  };

  return NextResponse.json({ item: result });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();

  const [existing] = await db
    .select()
    .from(knowledgeItems)
    .where(eq(knowledgeItems.id, id));

  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const updates: Record<string, unknown> = { updatedAt: now() };

  // Allow manual verification
  if (body.verified === true) {
    updates.lastVerified = now();
    updates.status = "current";
  }

  // Allow status change
  if (body.status) {
    updates.status = body.status;
  }

  // Allow title edit
  if (body.title) {
    updates.title = body.title;
  }

  // Allow content edit (manual override)
  if (body.content) {
    updates.content = body.content;
  }

  await db
    .update(knowledgeItems)
    .set(updates)
    .where(eq(knowledgeItems.id, id));

  const [updated] = await db
    .select()
    .from(knowledgeItems)
    .where(eq(knowledgeItems.id, id));

  return NextResponse.json({ item: serializeKnowledgeItem(updated) });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Delete claims first
  await db.delete(knowledgeClaims).where(eq(knowledgeClaims.knowledgeItemId, id));
  await db.delete(knowledgeItems).where(eq(knowledgeItems.id, id));

  return NextResponse.json({ success: true });
}
