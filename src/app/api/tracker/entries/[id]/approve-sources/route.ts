import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { entries, sourceDocuments } from "@/db/schema";
import { eq } from "drizzle-orm";
import { generateId, now } from "@/lib/utils";
import { fetchAndExtract, deriveFetchStatus } from "@/lib/source-fetcher";
import { inferSourceTier } from "@/lib/source-tiers";
import { extractAndStoreTermsForDoc } from "@/lib/defined-terms-ai";

export const maxDuration = 120;

interface Body {
  urls: string[];
}

interface ApprovedResult {
  url: string;
  documentId: string | null;
  tier: string;
  ok: boolean;
  extracted: boolean;
  truncated: boolean;
  byteCount: number | null;
  title: string | null;
  error: string | null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await request.json()) as Body;

  if (!Array.isArray(body.urls) || body.urls.length === 0) {
    return NextResponse.json({ error: "urls (non-empty array) required" }, { status: 400 });
  }

  const entry = db.select().from(entries).where(eq(entries.id, id)).get();
  if (!entry) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  }

  // Skip URLs that already have a source_document on this entry to make the
  // call idempotent — repeat approval of the same URL is a no-op.
  const existingDocUrls = new Set(
    db
      .select({ url: sourceDocuments.sourceUrl })
      .from(sourceDocuments)
      .where(eq(sourceDocuments.entryId, id))
      .all()
      .map((r) => r.url)
      .filter((u): u is string => !!u)
  );

  const ts = now();
  const results: ApprovedResult[] = [];

  for (const url of body.urls) {
    if (existingDocUrls.has(url)) {
      results.push({
        url,
        documentId: null,
        tier: inferSourceTier(url).tier,
        ok: true,
        extracted: false,
        truncated: false,
        byteCount: null,
        title: null,
        error: "Already attached to this entry",
      });
      continue;
    }

    const fetched = await fetchAndExtract(url);
    const tier = inferSourceTier(fetched.url).tier;
    const docId = generateId();

    const docName = fetched.title?.slice(0, 200) || url;

    db.insert(sourceDocuments)
      .values({
        id: docId,
        entryId: id,
        name: docName,
        sourceUrl: fetched.url,
        fullText: fetched.fullText,
        fileType: fetched.extractor === "direct-pdf" ? "pdf" : guessFileType(fetched.url),
        charCount: fetched.fullText ? fetched.fullText.length : null,
        addedBy: "ai",
        sourceAuthority: tier,
        verifiedUrl: fetched.ok,
        lastUrlCheck: ts,
        contentHash: fetched.contentHash,
        retrievedAt: fetched.fetchedAt,
        fetchStatus: deriveFetchStatus(fetched),
        fetchError: fetched.error,
        extractor: fetched.extractor,
        createdAt: ts,
        updatedAt: ts,
      })
      .run();

    // Fire-and-forget term extraction for the freshly-stored doc.
    if (fetched.fullText && fetched.fullText.length > 200) {
      void extractAndStoreTermsForDoc(id, {
        id: docId,
        name: docName,
        fullText: fetched.fullText,
      }).catch((err) =>
        console.error(`Background term extraction failed for approved doc ${docId}:`, err)
      );
    }

    results.push({
      url: fetched.url,
      documentId: docId,
      tier,
      ok: fetched.ok,
      extracted: fetched.extracted,
      truncated: fetched.truncated,
      byteCount: fetched.byteCount,
      title: fetched.title,
      error: fetched.error,
    });
  }

  // Touch the entry's updatedAt so any UI watching it refreshes.
  db.update(entries).set({ updatedAt: ts }).where(eq(entries.id, id)).run();

  return NextResponse.json({
    ok: true,
    approved: results.filter((r) => r.documentId !== null).length,
    results,
  });
}

function guessFileType(url: string): string | null {
  const lower = url.toLowerCase();
  if (lower.endsWith(".pdf") || lower.includes(".pdf?")) return "pdf";
  if (lower.endsWith(".doc") || lower.endsWith(".docx")) return "docx";
  if (lower.endsWith(".txt")) return "txt";
  return "html";
}
