import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { entries, sourceDocuments, definedTerms } from "@/db/schema";
import { eq } from "drizzle-orm";
import { extractAndStoreTermsForDoc } from "@/lib/defined-terms-ai";

// Extract defined terms from an entry's source documents and store them in
// the defined_terms table. Idempotent per (sourceDocId): re-running replaces
// the prior extraction for that document.
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

  const summaries: { sourceDocId: string; docName: string; termCount: number }[] = [];

  for (const doc of groundedDocs) {
    try {
      const { termCount } = await extractAndStoreTermsForDoc(id, doc);
      summaries.push({ sourceDocId: doc.id, docName: doc.name, termCount });
    } catch (err) {
      console.error(`Term extraction failed for doc ${doc.id}:`, err);
    }
  }

  return NextResponse.json({ extractions: summaries });
}

// List all defined terms for an entry. Useful for the UI panel and for the
// summary-ai prompt-injection helper.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const terms = await db
    .select()
    .from(definedTerms)
    .where(eq(definedTerms.entryId, id));
  return NextResponse.json({ terms });
}
