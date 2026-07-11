import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sourceDocuments } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { now } from "@/lib/utils";
import { PRIMARY_TEXT, SUPPORTING } from "@/lib/source-roles";
import type { SourceDocumentRole } from "@/lib/types";

// Manually (de)designate a source doc as the entry's primary text. Promoting a
// doc to primary_text demotes any current primary text on the same entry, so
// the "one instrument per entry" invariant holds.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> }
) {
  const { id, docId } = await params;
  const body = await request.json().catch(() => ({}));
  const role = body?.role as SourceDocumentRole | undefined;

  if (role !== PRIMARY_TEXT && role !== SUPPORTING) {
    return NextResponse.json(
      { error: "role must be 'primary_text' or 'supporting'" },
      { status: 400 }
    );
  }

  const doc = db
    .select({ id: sourceDocuments.id })
    .from(sourceDocuments)
    .where(and(eq(sourceDocuments.id, docId), eq(sourceDocuments.entryId, id)))
    .get();
  if (!doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  const ts = now();

  if (role === PRIMARY_TEXT) {
    // Demote the incumbent primary text (if any) first.
    db.update(sourceDocuments)
      .set({ role: SUPPORTING, updatedAt: ts })
      .where(
        and(eq(sourceDocuments.entryId, id), eq(sourceDocuments.role, PRIMARY_TEXT))
      )
      .run();
  }

  db.update(sourceDocuments)
    .set({ role, updatedAt: ts })
    .where(eq(sourceDocuments.id, docId))
    .run();

  return NextResponse.json({ ok: true, role });
}
