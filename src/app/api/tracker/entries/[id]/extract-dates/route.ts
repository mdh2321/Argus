import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { entries, sourceDocuments } from "@/db/schema";
import { eq } from "drizzle-orm";
import { extractKeyDates, mergeKeyDates } from "@/lib/key-dates-ai";
import { syncDeadlines, computeNextKeyDate, serializeEntry } from "@/lib/entry-helpers";
import { logAgentRun } from "@/lib/agent-runs";
import { toJsonString, now, parseJsonField } from "@/lib/utils";
import type { KeyDate } from "@/lib/types";

// Extract dated milestones (commencement, application, transition ends,
// consultation windows) from an entry's source documents and merge them into
// keyDates. Existing dates win on conflict; the deadlines table re-syncs so
// Tracker deadlines pick the new dates up immediately.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const [entry] = await db.select().from(entries).where(eq(entries.id, id));
  if (!entry) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  }

  const docs = await db
    .select()
    .from(sourceDocuments)
    .where(eq(sourceDocuments.entryId, id));
  const groundedDocs = docs.filter((d) => d.fullText && d.fullText.length > 200);
  if (groundedDocs.length === 0) {
    return NextResponse.json(
      { error: "No source documents with text to extract from" },
      { status: 400 }
    );
  }

  const extracted = await extractKeyDates({
    entryName: entry.shortName,
    docs: groundedDocs.map((d) => ({ name: d.name, fullText: d.fullText! })),
    today: new Date().toISOString().slice(0, 10),
  });

  const existing = parseJsonField<KeyDate[]>(entry.keyDates) ?? [];
  const { merged, added } = mergeKeyDates(existing, extracted);

  if (added.length > 0) {
    const keyDatesJson = toJsonString(merged);
    await db
      .update(entries)
      .set({
        keyDates: keyDatesJson,
        nextKeyDate: computeNextKeyDate(keyDatesJson),
        updatedAt: now(),
      })
      .where(eq(entries.id, id));
    await syncDeadlines(id, keyDatesJson);
  }

  void logAgentRun({
    workflow: "dates",
    modelUsed: "claude-haiku-4-5-20251001",
    entriesUpdated: added.length > 0 ? 1 : 0,
    sourcesChecked: groundedDocs.map((d) => d.name),
  });

  const [updated] = await db.select().from(entries).where(eq(entries.id, id));
  return NextResponse.json({
    extractedCount: extracted.length,
    added,
    entry: serializeEntry(updated),
  });
}
