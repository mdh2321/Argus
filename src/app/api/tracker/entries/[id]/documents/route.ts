import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sourceDocuments, entries } from "@/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { generateId, now } from "@/lib/utils";
import { extractAndStoreTermsForDoc } from "@/lib/defined-terms-ai";
import { fetchAndExtract, deriveFetchStatus } from "@/lib/source-fetcher";
import { isPrimaryTextCandidate, PRIMARY_TEXT, SUPPORTING } from "@/lib/source-roles";
import type { SourceDocumentRole } from "@/lib/types";

export const maxDuration = 120;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const docs = await db
    .select()
    .from(sourceDocuments)
    .where(eq(sourceDocuments.entryId, id))
    .orderBy(desc(sourceDocuments.createdAt));

  return NextResponse.json({ documents: docs });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Verify entry exists
  const [entry] = await db.select().from(entries).where(eq(entries.id, id));
  if (!entry) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  }

  const body = await request.json();
  const { name, sourceUrl, fullText, fileType, addedBy } = body;

  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const timestamp = now();
  const docId = generateId();

  // If the user supplied text directly, store it as-is and mark fetch_status
  // "manual". If they supplied only a URL, fetch it now so the doc lands with
  // text — silently storing a bare URL is what made "Run full analysis" look
  // like it was working when it wasn't.
  let resolvedFullText: string | null = fullText || null;
  let resolvedFileType: string | null = fileType || null;
  let resolvedUrl: string | null = sourceUrl || null;
  let resolvedCharCount: number | null = fullText ? fullText.length : null;
  let fetchStatus: "ok" | "no_text" | "fetch_failed" | "manual" = fullText
    ? "manual"
    : "fetch_failed";
  let fetchError: string | null = null;
  let extractor: string | null = null;
  let contentHash: string | null = null;
  let retrievedAt: string | null = null;
  let verifiedUrl = false;

  if (!fullText && sourceUrl) {
    const fetched = await fetchAndExtract(sourceUrl);
    resolvedUrl = fetched.url;
    resolvedFullText = fetched.fullText;
    resolvedCharCount = fetched.fullText ? fetched.fullText.length : null;
    fetchStatus = deriveFetchStatus(fetched);
    fetchError = fetched.error;
    extractor = fetched.extractor;
    contentHash = fetched.contentHash;
    retrievedAt = fetched.fetchedAt;
    verifiedUrl = fetched.ok;
    if (!resolvedFileType) {
      resolvedFileType =
        fetched.extractor === "direct-pdf"
          ? "pdf"
          : fetched.extractor
            ? "html"
            : "link";
    }
  }

  // Evidence role (plan §1.1). Designate this doc the instrument's primary text
  // only if it reads like the instrument itself AND the entry has no primary
  // text yet — an entry has at most one. Otherwise it's supporting material.
  const entryHasPrimary = !!db
    .select({ id: sourceDocuments.id })
    .from(sourceDocuments)
    .where(and(eq(sourceDocuments.entryId, id), eq(sourceDocuments.role, PRIMARY_TEXT)))
    .get();
  const role: SourceDocumentRole =
    !entryHasPrimary &&
    isPrimaryTextCandidate({
      sourceUrl: resolvedUrl,
      fullText: resolvedFullText,
      sourceAuthority: null,
    })
      ? PRIMARY_TEXT
      : SUPPORTING;

  const doc = {
    id: docId,
    entryId: id,
    name,
    sourceUrl: resolvedUrl,
    fullText: resolvedFullText,
    fileType: resolvedFileType,
    charCount: resolvedCharCount,
    addedBy: addedBy || "manual",
    role,
    verifiedUrl,
    lastUrlCheck: resolvedUrl ? timestamp : null,
    contentHash,
    retrievedAt,
    fetchStatus,
    fetchError,
    extractor,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  await db.insert(sourceDocuments).values(doc);

  // Fire-and-forget background term extraction. The user gets an immediate
  // 201 response; defined terms appear in the entry's term registry whenever
  // the extraction finishes.
  if (doc.fullText && doc.fullText.length > 200) {
    void extractAndStoreTermsForDoc(id, {
      id: doc.id,
      name: doc.name,
      fullText: doc.fullText,
    }).catch((err) =>
      console.error(`Background term extraction failed for doc ${doc.id}:`, err)
    );
  }

  return NextResponse.json({ document: doc }, { status: 201 });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await params;
  const { searchParams } = new URL(request.url);
  const docId = searchParams.get("docId");

  if (!docId) {
    return NextResponse.json({ error: "docId is required" }, { status: 400 });
  }

  await db.delete(sourceDocuments).where(eq(sourceDocuments.id, docId));

  return NextResponse.json({ deleted: true });
}
