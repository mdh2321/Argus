import "server-only";

import { db } from "@/db";
import { entries, sourceDocuments, knowledgeItems, digestIssues, digestStories, signals } from "@/db/schema";
import { serializeEntry } from "@/lib/entry-helpers";
import { and, eq, ne, inArray, isNotNull } from "drizzle-orm";
import { formatDate, generateId, now } from "@/lib/utils";
import { fetchAndExtract } from "@/lib/source-fetcher";
import type { Entry } from "@/lib/types";
import type { AskArgusAction } from "@/lib/ask-types";

/**
 * A single retrievable record in the Ask corpus. Tracker entries, digest
 * stories, knowledge items, and signals are all flattened into this shape so
 * retrieval (FTS5) and answer synthesis can treat them uniformly.
 */
export interface CorpusItem {
  id: string;
  kind: "tracker" | "digest" | "signal";
  title: string;
  href: string;
  body: string;
  meta: string;
  sourceLabel: string;
  date: string;
  jurisdiction: string;
  impactRank: number;
  urgencyRank: number;
  actions: AskArgusAction[];
  externalUrl?: string;
  sourceUrls?: string[];
  // §3.3/§3.4 — authority tier for ordering + the entry's formal citation for
  // copy-as-citation. Populated for tracker entries only.
  authorityTier?: string;
  formalCitation?: string | null;
}

export async function buildCorpus(): Promise<CorpusItem[]> {
  const activeRows = await db
    .select()
    .from(entries)
    .where(eq(entries.archived, false));

  const allDocs = await db
    .select({ entryId: sourceDocuments.entryId, fullText: sourceDocuments.fullText })
    .from(sourceDocuments)
    .where(isNotNull(sourceDocuments.fullText));
  const docsByEntry = new Map<string, string[]>();
  for (const doc of allDocs) {
    if (!doc.fullText) continue;
    const existing = docsByEntry.get(doc.entryId) || [];
    existing.push(doc.fullText.slice(0, 2000));
    docsByEntry.set(doc.entryId, existing);
  }

  const trackerItems = activeRows.map(serializeEntry).map((entry) =>
    entryToCorpusItem(entry, docsByEntry.get(entry.id))
  );

  // Query digest stories from DB. Regulatory only — Industry Intel / pulse
  // items are legal-tech industry news, not law, and don't belong in the
  // Ask corpus (refinement plan B2).
  const allIssueRows = await db.select().from(digestIssues);
  const allStoryRows = await db
    .select()
    .from(digestStories)
    .where(eq(digestStories.contentType, "regulatory"));
  const issueMap = new Map(allIssueRows.map((i) => [i.id, i]));

  const digestItems = allStoryRows.map((story) => {
    const issue = story.issueId ? issueMap.get(story.issueId) : null;
    return digestStoryToCorpusItem(
      issue ? { slug: issue.slug, title: issue.title } : { slug: "", title: "" },
      {
        id: story.id,
        title: story.title,
        url: story.url || "#",
        source: story.source,
        date: story.date,
        summary: story.summary,
        takeaways: story.takeaways ? JSON.parse(story.takeaways) : [],
        jurisdiction: story.jurisdiction || "",
        jurisdictionCode: story.jurisdictionCode || "",
        categories: story.categories ? JSON.parse(story.categories) : [],
        urgency: story.urgency || "awareness_only",
        impact: story.impact || "Low",
        complianceDeadline: story.complianceDeadline || undefined,
      }
    );
  });

  // Include knowledge items (pre-compiled cross-cutting knowledge)
  const knowledgeRows = await db
    .select()
    .from(knowledgeItems)
    .where(ne(knowledgeItems.status, "retired"));

  const knowledgeCorpusItems = knowledgeRows.map(knowledgeToCorpusItem);

  // Include active signals
  const signalRows = await db
    .select()
    .from(signals)
    .where(eq(signals.status, "active"));

  const signalCorpusItems = signalRows.map((sig): CorpusItem => {
    const jurisdictions = sig.jurisdictions ? JSON.parse(sig.jurisdictions) as string[] : [];
    return {
      id: `sig:${sig.id}`,
      kind: "signal",
      title: sig.title,
      href: sig.link || "/",
      body: [sig.title, sig.summary, jurisdictions.join(" ")].join(" "),
      meta: `Signal · ${sig.scope} · ${sig.trendDirection} · ${sig.confidence} confidence`,
      sourceLabel: "Argus Signal",
      date: sig.updatedAt,
      jurisdiction: jurisdictions[0] || "",
      impactRank: sig.confidence === "high" ? 5 : sig.confidence === "medium" ? 3 : 1,
      urgencyRank: 2,
      actions: [],
    };
  });

  return [...knowledgeCorpusItems, ...signalCorpusItems, ...trackerItems, ...digestItems];
}

function entryToCorpusItem(entry: Entry, docSnippets?: string[]): CorpusItem {
  const nextDate = entry.nextKeyDate ? `Next key date ${formatDate(entry.nextKeyDate)}.` : "";
  const body = [
    entry.shortName, entry.fullName, entry.summary, entry.whyItMatters,
    entry.impactOnUs ? `Impact on us: ${entry.impactOnUs}` : null,
    entry.impactOnCustomers ? `Impact on our customers: ${entry.impactOnCustomers}` : null,
    entry.complianceImplications, entry.notes, entry.category, entry.regulator,
    entry.tags?.join(" "), nextDate, ...(docSnippets || []),
  ].filter(Boolean).join(" ");

  const actions: AskArgusAction[] = [];
  if (entry.complianceImplications) {
    actions.push({ title: "Compliance implication", detail: entry.complianceImplications, href: `/tracker/${entry.id}` });
  }
  if (entry.whyItMatters) {
    actions.push({ title: "Why this matters", detail: entry.whyItMatters, href: `/tracker/${entry.id}` });
  }
  if (entry.keyDates?.[0]) {
    actions.push({ title: entry.keyDates[0].label, detail: `Prepare for ${formatDate(entry.keyDates[0].date)}.`, href: `/tracker/${entry.id}` });
  }

  return {
    id: entry.id,
    kind: "tracker",
    title: entry.shortName,
    href: `/tracker/${entry.id}`,
    body,
    meta: `${entry.jurisdiction} · ${entry.category} · ${entry.status.replaceAll("_", " ")}`,
    sourceLabel: entry.regulator || "Tracker record",
    date: entry.nextKeyDate || entry.updatedAt,
    jurisdiction: entry.jurisdiction,
    impactRank: entry.impactScore || 1,
    urgencyRank: entry.nextKeyDate ? 3 : entry.status === "enforcement" ? 3 : 2,
    actions,
    externalUrl: entry.sourceUrls?.[0]?.url,
    sourceUrls: entry.sourceUrls?.map((s) => s.url) || undefined,
    authorityTier: entryAuthorityTier(entry.type),
    formalCitation: entry.formalCitation ?? null,
  };
}

// Coarse authority tier for a tracker entry, for authority-first citation
// ordering (§3.3). Mirrors source-tiers' vocabulary.
export function entryAuthorityTier(type: string): string {
  if (["legislation", "amending-act", "bill"].includes(type)) return "primary_legislation";
  if (["regulation", "binding-guidance"].includes(type)) return "regulator";
  return "commentary";
}

/**
 * Primary-text source documents keyed by entry id (§3.2). Only docs designated
 * as the instrument's primary text with usable full text — these are the
 * passages global Ask grounds instrument-level claims in.
 */
export async function getPrimaryTextDocs(
  entryIds: string[]
): Promise<Map<string, { docId: string; fullText: string }>> {
  const out = new Map<string, { docId: string; fullText: string }>();
  if (entryIds.length === 0) return out;
  const docs = await db
    .select({ id: sourceDocuments.id, entryId: sourceDocuments.entryId, fullText: sourceDocuments.fullText })
    .from(sourceDocuments)
    .where(and(eq(sourceDocuments.role, "primary_text"), inArray(sourceDocuments.entryId, entryIds)));
  for (const doc of docs) {
    if (!doc.fullText) continue;
    // One primary text per entry — first wins.
    if (!out.has(doc.entryId)) out.set(doc.entryId, { docId: doc.id, fullText: doc.fullText });
  }
  return out;
}

function digestStoryToCorpusItem(
  issue: { slug: string; title: string },
  story: { id: string; title: string; url: string; source: string; date: string; summary: string; takeaways: string[]; jurisdiction: string; jurisdictionCode: string; categories: string[]; urgency: string; impact: string; complianceDeadline?: string }
): CorpusItem {
  const href = issue.slug ? `/digest/issues/${issue.slug}#${story.id}` : `/digest`;
  return {
    id: issue.slug ? `${issue.slug}:${story.id}` : story.id,
    kind: "digest",
    title: story.title,
    href,
    body: [story.title, story.summary, story.takeaways.join(" "), story.categories.join(" "), story.jurisdiction, issue.title].join(" "),
    meta: `${story.jurisdiction} · ${story.impact} impact`,
    sourceLabel: story.source,
    date: story.complianceDeadline || story.date,
    jurisdiction: story.jurisdictionCode,
    impactRank: story.impact === "High" ? 5 : story.impact === "Medium" ? 3 : 1,
    urgencyRank: story.urgency === "immediate_action" ? 3 : story.urgency === "monitor_closely" ? 2 : 1,
    actions: story.takeaways.slice(0, 2).map((takeaway) => ({
      title: "Digest takeaway", detail: takeaway, href,
    })),
    externalUrl: story.url !== "#" ? story.url : undefined,
  };
}

function knowledgeToCorpusItem(ki: typeof knowledgeItems.$inferSelect): CorpusItem {
  const confidenceBoost = ki.confidence === "high" ? 3 : ki.confidence === "medium" ? 2 : 1;
  const body = [ki.title, ki.content.slice(0, 3000), ki.itemType, ki.jurisdiction, ki.category].filter(Boolean).join(" ");

  return {
    id: `ki:${ki.id}`,
    kind: "tracker", // knowledge items surface as high-quality tracker-like results
    title: `${ki.title} [${ki.itemType}]`,
    href: `/library/briefings/${ki.id}`,
    body,
    meta: `${ki.jurisdiction || "APAC"} · ${ki.itemType} · ${ki.confidence} confidence · ${Math.round((ki.groundingRatio || 0) * 100)}% grounded`,
    sourceLabel: `Knowledge: ${ki.itemType}`,
    date: ki.updatedAt,
    jurisdiction: ki.jurisdiction || "",
    impactRank: confidenceBoost + 2, // knowledge items rank higher
    urgencyRank: ki.status === "stale" ? 1 : 2,
    actions: [],
  };
}

/** Outcome of the source-content fetch pass, including previously-silent failures. */
export interface SourceFetchOutcome {
  contents: Map<string, string>;
  /** Items whose URL fetch produced no usable text (timeout, blocked, empty). */
  failed: { id: string; url: string }[];
  /** Item ids served from a fresh source_documents cache entry, no live fetch. */
  cached: Set<string>;
}

// A cached ask-fetch is considered fresh for 7 days, then re-fetched.
const FETCH_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Hard ceiling on a live fetch inside the answer path — fetchAndExtract's own
// direct-fallback timeout (30s) is fine for pipelines, too slow for Ask.
const ASK_FETCH_TIMEOUT_MS = 12_000;

/**
 * Fetch page text for corpus items that carry source URLs — cache-first.
 * Successful live fetches for tracker entries are written back to
 * source_documents (role "supporting") so the next ask skips the fetch and
 * the text becomes available to pins and verification. Best-effort — every
 * failure mode is reported in the outcome instead of vanishing.
 */
export async function fetchSourceContents(items: CorpusItem[]): Promise<SourceFetchOutcome> {
  const contents = new Map<string, string>();
  const failed: { id: string; url: string }[] = [];
  const cached = new Set<string>();

  const toFetch: { id: string; url: string; entryId: string | null }[] = [];

  for (const item of items) {
    const url = item.sourceUrls?.[0] || item.externalUrl;
    if (!url) continue;
    // Knowledge items masquerade as kind "tracker" with a ki: prefix — they
    // have no entries row, so never write cache rows for them.
    const entryId = item.kind === "tracker" && !item.id.startsWith("ki:") ? item.id : null;

    if (entryId) {
      const hit = lookupCachedFetch(entryId, url);
      if (hit) {
        contents.set(item.id, hit.slice(0, 15000));
        cached.add(item.id);
        continue;
      }
    }
    toFetch.push({ id: item.id, url, entryId });
  }

  const results = await Promise.allSettled(
    toFetch.map(async ({ id, url, entryId }) => {
      const result = await withTimeout(fetchAndExtract(url), ASK_FETCH_TIMEOUT_MS);
      if (!result?.extracted || !result.fullText) return { id, url, text: "" };
      if (entryId) cacheFetchedDoc(entryId, url, result.fullText, result.title, result.extractor, result.contentHash);
      return { id, url, text: result.fullText.slice(0, 15000) };
    })
  );

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled" && r.value.text) {
      contents.set(r.value.id, r.value.text);
    } else {
      failed.push({ id: toFetch[i].id, url: toFetch[i].url });
    }
  }

  return { contents, failed, cached };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);
}

/** A fresh (≤7 day old) ask-cached or user-added doc for this entry+URL, if any. */
function lookupCachedFetch(entryId: string, url: string): string | null {
  const rows = db
    .select({
      fullText: sourceDocuments.fullText,
      retrievedAt: sourceDocuments.retrievedAt,
      addedBy: sourceDocuments.addedBy,
    })
    .from(sourceDocuments)
    .where(and(eq(sourceDocuments.entryId, entryId), eq(sourceDocuments.sourceUrl, url), isNotNull(sourceDocuments.fullText)))
    .all();
  for (const row of rows) {
    if (!row.fullText) continue;
    // Manually-added docs never expire; ask-cached ones respect the TTL.
    if (row.addedBy !== "ask-cache") return row.fullText;
    const age = row.retrievedAt ? Date.now() - new Date(row.retrievedAt).getTime() : Infinity;
    if (age < FETCH_CACHE_TTL_MS) return row.fullText;
  }
  return null;
}

/** Persist a successful ask-path fetch so subsequent asks read it as a stored doc. */
function cacheFetchedDoc(
  entryId: string,
  url: string,
  fullText: string,
  title: string | null,
  extractor: string | null,
  contentHash: string | null
): void {
  try {
    const ts = now();
    // Refresh in place if we already hold an ask-cache row for this URL.
    const [existing] = db
      .select({ id: sourceDocuments.id })
      .from(sourceDocuments)
      .where(
        and(
          eq(sourceDocuments.entryId, entryId),
          eq(sourceDocuments.sourceUrl, url),
          eq(sourceDocuments.addedBy, "ask-cache")
        )
      )
      .all();
    if (existing) {
      db.update(sourceDocuments)
        .set({ fullText, charCount: fullText.length, contentHash, retrievedAt: ts, updatedAt: ts, fetchStatus: "ok", extractor })
        .where(eq(sourceDocuments.id, existing.id))
        .run();
      return;
    }
    db.insert(sourceDocuments)
      .values({
        id: generateId(),
        entryId,
        name: title || `Fetched: ${new URL(url).hostname}`,
        sourceUrl: url,
        fullText,
        fileType: "html",
        charCount: fullText.length,
        addedBy: "ask-cache",
        role: "supporting",
        sourceAuthority: "unknown",
        fetchStatus: "ok",
        extractor,
        contentHash,
        retrievedAt: ts,
        createdAt: ts,
        updatedAt: ts,
      })
      .run();
  } catch (err) {
    // Caching is an optimisation — never let it break the answer path.
    console.error("Ask fetch-cache write failed:", err);
  }
}

/**
 * Best-effort fetch + readable-text extraction for a single URL. Returns "" on
 * any failure (timeout, non-2xx, network) rather than throwing. Delegates to
 * the Readability/Exa fetcher (the old regex tag-stripper polluted the budget
 * with nav and cookie banners), capped for the answer path.
 */
export async function fetchUrlText(url: string): Promise<string> {
  const result = await withTimeout(fetchAndExtract(url), ASK_FETCH_TIMEOUT_MS);
  return result?.extracted && result.fullText ? result.fullText : "";
}

export async function getStoredDocTexts(entryIds: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (entryIds.length === 0) return result;

  const docs = await db
    .select({ entryId: sourceDocuments.entryId, fullText: sourceDocuments.fullText })
    .from(sourceDocuments)
    .where(and(inArray(sourceDocuments.entryId, entryIds), isNotNull(sourceDocuments.fullText)));
  for (const doc of docs) {
    if (!doc.fullText) continue;
    const existing = result.get(doc.entryId) || "";
    result.set(doc.entryId, (existing + "\n\n" + doc.fullText.slice(0, 20000)).trim());
  }
  return result;
}

