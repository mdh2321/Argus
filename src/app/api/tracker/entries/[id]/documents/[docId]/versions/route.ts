import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sourceDocumentVersions } from "@/db/schema";
import { eq, desc } from "drizzle-orm";

// Compilation history for a source doc — newest snapshot first. Bodies can be
// large, so the list omits full_text; callers fetch a single version's text
// on demand via ?versionId=.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ docId: string }> }
) {
  const { docId } = await params;
  const { searchParams } = new URL(request.url);
  const versionId = searchParams.get("versionId");

  if (versionId) {
    const version = db
      .select()
      .from(sourceDocumentVersions)
      .where(eq(sourceDocumentVersions.id, versionId))
      .get();
    if (!version) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 });
    }
    return NextResponse.json({ version });
  }

  const versions = db
    .select({
      id: sourceDocumentVersions.id,
      sourceDocId: sourceDocumentVersions.sourceDocId,
      entryId: sourceDocumentVersions.entryId,
      contentHash: sourceDocumentVersions.contentHash,
      charCount: sourceDocumentVersions.charCount,
      retrievedAt: sourceDocumentVersions.retrievedAt,
      trigger: sourceDocumentVersions.trigger,
      createdAt: sourceDocumentVersions.createdAt,
    })
    .from(sourceDocumentVersions)
    .where(eq(sourceDocumentVersions.sourceDocId, docId))
    .orderBy(desc(sourceDocumentVersions.createdAt))
    .all();

  return NextResponse.json({ versions });
}
