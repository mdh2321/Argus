import { db } from "@/db";
import { sourceDocuments, entryChanges, sourceDocumentVersions, entryRelationships, entries } from "@/db/schema";
import { eq, lt, and, isNotNull, or, isNull } from "drizzle-orm";
import { generateId, now } from "@/lib/utils";
import { fetchAndExtract, deriveFetchStatus } from "@/lib/source-fetcher";
import { extractAndStoreTermsForDoc } from "@/lib/defined-terms-ai";

export interface RefreshOutcome {
  documentId: string;
  url: string;
  status: "unchanged" | "changed" | "fetch_failed" | "extraction_failed" | "no_url";
  oldHash: string | null;
  newHash: string | null;
  byteCount: number | null;
  error: string | null;
}

/**
 * Re-fetch a single source_document, compare hash, persist updates, log to
 * entry_changes when the text changes.
 *
 * The function is non-throwing — every failure mode is encoded in the
 * returned outcome so callers can summarize without try/catch.
 */
export async function refreshSourceDocument(
  documentId: string,
  trigger: "refresh" | "amendment" = "refresh"
): Promise<RefreshOutcome> {
  const doc = db
    .select()
    .from(sourceDocuments)
    .where(eq(sourceDocuments.id, documentId))
    .get();

  if (!doc) {
    return {
      documentId,
      url: "",
      status: "fetch_failed",
      oldHash: null,
      newHash: null,
      byteCount: null,
      error: "Document not found",
    };
  }

  if (!doc.sourceUrl) {
    return {
      documentId,
      url: "",
      status: "no_url",
      oldHash: doc.contentHash,
      newHash: null,
      byteCount: null,
      error: "Document has no sourceUrl to re-fetch",
    };
  }

  const fetched = await fetchAndExtract(doc.sourceUrl);
  const ts = now();

  // Always update lastUrlCheck so we don't keep retrying dead URLs every run.
  if (!fetched.ok) {
    db.update(sourceDocuments)
      .set({
        lastUrlCheck: ts,
        updatedAt: ts,
        fetchStatus: deriveFetchStatus(fetched),
        fetchError: fetched.error,
      })
      .where(eq(sourceDocuments.id, doc.id))
      .run();
    return {
      documentId,
      url: doc.sourceUrl,
      status: "fetch_failed",
      oldHash: doc.contentHash,
      newHash: null,
      byteCount: null,
      error: fetched.error,
    };
  }

  if (!fetched.extracted) {
    db.update(sourceDocuments)
      .set({
        lastUrlCheck: ts,
        verifiedUrl: true,
        updatedAt: ts,
        fetchStatus: deriveFetchStatus(fetched),
        fetchError: fetched.error,
      })
      .where(eq(sourceDocuments.id, doc.id))
      .run();
    return {
      documentId,
      url: doc.sourceUrl,
      status: "extraction_failed",
      oldHash: doc.contentHash,
      newHash: null,
      byteCount: null,
      error: fetched.error,
    };
  }

  const oldHash = doc.contentHash;
  const newHash = fetched.contentHash;
  const unchanged = oldHash !== null && oldHash === newHash;

  if (unchanged) {
    db.update(sourceDocuments)
      .set({
        lastUrlCheck: ts,
        verifiedUrl: true,
        updatedAt: ts,
        fetchStatus: "ok",
        fetchError: null,
        extractor: fetched.extractor,
      })
      .where(eq(sourceDocuments.id, doc.id))
      .run();
    return {
      documentId,
      url: doc.sourceUrl,
      status: "unchanged",
      oldHash,
      newHash,
      byteCount: fetched.byteCount,
      error: null,
    };
  }

  // Text changed. Before overwriting, snapshot the OUTGOING compilation so we
  // can answer "what did this say when we assessed it" (P1.3). Only snapshot
  // when there's prior text and a prior hash — a first-ever fetch has nothing
  // worth preserving.
  if (oldHash !== null && doc.fullText) {
    db.insert(sourceDocumentVersions)
      .values({
        id: generateId(),
        sourceDocId: doc.id,
        entryId: doc.entryId,
        contentHash: oldHash,
        fullText: doc.fullText,
        charCount: doc.charCount ?? doc.fullText.length,
        retrievedAt: doc.retrievedAt,
        trigger,
        createdAt: ts,
      })
      .run();
  }

  // Text changed (or first time we have a hash). Persist new state and log it.
  db.update(sourceDocuments)
    .set({
      fullText: fetched.fullText,
      contentHash: newHash,
      charCount: fetched.fullText ? fetched.fullText.length : null,
      verifiedUrl: true,
      lastUrlCheck: ts,
      retrievedAt: fetched.fetchedAt,
      fetchStatus: "ok",
      fetchError: null,
      extractor: fetched.extractor,
      updatedAt: ts,
    })
    .where(eq(sourceDocuments.id, doc.id))
    .run();

  // Only log a change when there was a previous hash to compare against —
  // a first-time fetch isn't an "update" worth flagging.
  if (oldHash !== null) {
    db.insert(entryChanges)
      .values({
        id: generateId(),
        entryId: doc.entryId,
        fieldChanged: "source_text",
        oldValue: oldHash,
        newValue: newHash,
        changeSummary: `Source text changed: ${doc.name || doc.sourceUrl}`,
        changedBy: "ai",
        sourceUrl: doc.sourceUrl,
        sourceSnapshotId: doc.id,
        changedAt: ts,
      })
      .run();
  }

  // §2.5 — if this doc belongs to guidance that `interprets` one or more
  // anchors, the anchors' grounding pool just changed. Bump each anchor's
  // updatedAt so the passive "Needs Review" trust badge surfaces (it fires when
  // an ai-generated entry's lastReviewed predates its updatedAt).
  if (oldHash !== null) {
    const interpretsRels = db
      .select({ toEntryId: entryRelationships.toEntryId })
      .from(entryRelationships)
      .where(
        and(
          eq(entryRelationships.fromEntryId, doc.entryId),
          eq(entryRelationships.kind, "interprets")
        )
      )
      .all();
    for (const rel of interpretsRels) {
      db.update(entries).set({ updatedAt: ts }).where(eq(entries.id, rel.toEntryId)).run();
    }
  }

  // Source text changed → re-extract defined terms in the background so the
  // statutory dictionary stays in sync with the upstream legislation.
  if (fetched.fullText && fetched.fullText.length > 200) {
    void extractAndStoreTermsForDoc(doc.entryId, {
      id: doc.id,
      name: doc.name,
      fullText: fetched.fullText,
    }).catch((err) =>
      console.error(`Background term re-extraction failed for refreshed doc ${doc.id}:`, err)
    );
  }

  return {
    documentId,
    url: doc.sourceUrl,
    status: oldHash === null ? "unchanged" : "changed",
    oldHash,
    newHash,
    byteCount: fetched.byteCount,
    error: null,
  };
}

export async function refreshSourcesForEntry(
  entryId: string,
  trigger: "refresh" | "amendment" = "refresh"
): Promise<RefreshOutcome[]> {
  const docs = db
    .select({ id: sourceDocuments.id })
    .from(sourceDocuments)
    .where(eq(sourceDocuments.entryId, entryId))
    .all();

  const out: RefreshOutcome[] = [];
  for (const d of docs) {
    out.push(await refreshSourceDocument(d.id, trigger));
  }
  return out;
}

export async function refreshStaleSources(
  maxAgeDays: number
): Promise<RefreshOutcome[]> {
  const cutoff = new Date(Date.now() - maxAgeDays * 86400000).toISOString();

  const docs = db
    .select({ id: sourceDocuments.id })
    .from(sourceDocuments)
    .where(
      and(
        isNotNull(sourceDocuments.sourceUrl),
        or(isNull(sourceDocuments.lastUrlCheck), lt(sourceDocuments.lastUrlCheck, cutoff))
      )
    )
    .all();

  const out: RefreshOutcome[] = [];
  for (const d of docs) {
    out.push(await refreshSourceDocument(d.id));
  }
  return out;
}
