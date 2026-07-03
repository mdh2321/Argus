import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { entries, sourceDocuments } from "@/db/schema";
import { eq } from "drizzle-orm";
import { suggestSources } from "@/lib/source-suggester";
import { upgradeSourceUrls } from "@/lib/source-tiers";

export const maxDuration = 60;

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const entry = db.select().from(entries).where(eq(entries.id, id)).get();
  if (!entry) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  }

  // Build the exclude list from existing source URLs and already-attached source documents.
  const existingSourceUrlsRaw = entry.sourceUrls ? JSON.parse(entry.sourceUrls) : null;
  const existingTrackerSources = upgradeSourceUrls(existingSourceUrlsRaw) ?? [];
  const docs = db
    .select({ url: sourceDocuments.sourceUrl })
    .from(sourceDocuments)
    .where(eq(sourceDocuments.entryId, id))
    .all();
  const docUrls = docs.map((d) => d.url).filter((u): u is string => !!u);

  const excludeUrls = [
    ...existingTrackerSources.map((s) => s.url),
    ...docUrls,
  ];

  try {
    const candidates = await suggestSources({
      shortName: entry.shortName,
      fullName: entry.fullName,
      jurisdiction: entry.jurisdiction,
      type: entry.type,
      regulator: entry.regulator,
      category: entry.category,
      excludeUrls,
    });
    return NextResponse.json({ candidates });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
