import "server-only";

import { db } from "@/db";
import { entries, sourceDocuments, knowledgeItems, digestIssues, digestStories, signals } from "@/db/schema";
import { serializeEntry } from "@/lib/entry-helpers";
import { eq, ne } from "drizzle-orm";
import { formatDate } from "@/lib/utils";
import type { Entry } from "@/lib/types";
import type { AskSentinelAction } from "@/lib/ask-types";

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
  actions: AskSentinelAction[];
  externalUrl?: string;
  sourceUrls?: string[];
}

export async function buildCorpus(): Promise<CorpusItem[]> {
  const activeRows = await db
    .select()
    .from(entries)
    .where(eq(entries.archived, false));

  const allDocs = await db.select().from(sourceDocuments);
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
      sourceLabel: "Sentinel Signal",
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

  const actions: AskSentinelAction[] = [];
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
  };
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

/**
 * Fetch live page text for a set of corpus items that carry source URLs.
 * Uses the Readability-based fetcher with a basic fallback. Best-effort —
 * failures resolve to no content rather than throwing.
 */
export async function fetchSourceContents(items: CorpusItem[]): Promise<Map<string, string>> {
  const contents = new Map<string, string>();
  const urlsToFetch: { id: string; url: string }[] = [];

  for (const item of items) {
    if (item.sourceUrls && item.sourceUrls.length > 0) {
      urlsToFetch.push({ id: item.id, url: item.sourceUrls[0] });
    } else if (item.externalUrl) {
      urlsToFetch.push({ id: item.id, url: item.externalUrl });
    }
  }

  const results = await Promise.allSettled(
    urlsToFetch.map(async ({ id, url }) => ({ id, text: (await fetchUrlText(url)).slice(0, 15000) }))
  );

  for (const result of results) {
    if (result.status === "fulfilled" && result.value.text) {
      contents.set(result.value.id, result.value.text);
    }
  }

  return contents;
}

/**
 * Best-effort fetch + readable-text extraction for a single URL. Returns "" on
 * any failure (timeout, non-2xx, network) rather than throwing. Shared by the
 * corpus source-fetch and the scoped-Ask resolver.
 */
export async function fetchUrlText(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Sentinel/1.0 (legal-intelligence)" },
    });
    if (!res.ok) return "";
    const html = await res.text();
    return extractTextFromHTML(html);
  } catch {
    return "";
  } finally {
    clearTimeout(timeout);
  }
}

export async function getStoredDocTexts(entryIds: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (entryIds.length === 0) return result;

  const allDocs = await db.select().from(sourceDocuments);
  for (const doc of allDocs) {
    if (doc.fullText && entryIds.includes(doc.entryId)) {
      const existing = result.get(doc.entryId) || "";
      result.set(doc.entryId, (existing + "\n\n" + doc.fullText.slice(0, 20000)).trim());
    }
  }
  return result;
}

function extractTextFromHTML(html: string): string {
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<[^>]+>/g, " ");
  text = text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
  text = text.replace(/\s+/g, " ").trim();
  return text;
}
