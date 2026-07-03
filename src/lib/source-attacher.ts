import { db } from "@/db";
import { entries, sourceDocuments } from "@/db/schema";
import { eq } from "drizzle-orm";
import { generateId, now } from "@/lib/utils";
import { fetchAndExtract, deriveFetchStatus } from "@/lib/source-fetcher";
import { inferSourceTier } from "@/lib/source-tiers";
import { extractAndStoreTermsForDoc } from "@/lib/defined-terms-ai";

// Shared by the approve-sources route and the grounding script: fetch each
// URL, store it as a source_document on the entry, and kick off background
// term extraction. Idempotent — URLs already attached are reported, not
// re-fetched.

export interface AttachResult {
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

export async function attachSourcesToEntry(
  entryId: string,
  urls: string[],
  opts: { awaitTermExtraction?: boolean } = {}
): Promise<AttachResult[]> {
  const existingDocUrls = new Set(
    db
      .select({ url: sourceDocuments.sourceUrl })
      .from(sourceDocuments)
      .where(eq(sourceDocuments.entryId, entryId))
      .all()
      .map((r) => r.url)
      .filter((u): u is string => !!u)
  );

  const ts = now();
  const results: AttachResult[] = [];

  for (const url of urls) {
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
        entryId,
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

    if (fetched.fullText && fetched.fullText.length > 200) {
      const extraction = extractAndStoreTermsForDoc(entryId, {
        id: docId,
        name: docName,
        fullText: fetched.fullText,
      }).catch((err) =>
        console.error(`Background term extraction failed for approved doc ${docId}:`, err)
      );
      if (opts.awaitTermExtraction) await extraction;
      else void extraction;
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

  db.update(entries).set({ updatedAt: ts }).where(eq(entries.id, entryId)).run();

  return results;
}

function guessFileType(url: string): string | null {
  const lower = url.toLowerCase();
  if (lower.endsWith(".pdf") || lower.includes(".pdf?")) return "pdf";
  if (lower.endsWith(".doc") || lower.endsWith(".docx")) return "docx";
  if (lower.endsWith(".txt")) return "txt";
  return "html";
}
