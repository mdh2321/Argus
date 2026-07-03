import "server-only";

import { db } from "@/db";
import { entries, sourceDocuments, digestStories, digestIssues, knowledgeItems, signals } from "@/db/schema";
import { eq } from "drizzle-orm";
import { serializeEntry } from "@/lib/entry-helpers";
import { fetchUrlText } from "@/lib/ask-corpus";
import type { TextChunk } from "@/lib/ask-retrieval";
import type { AskScope, AskSentinelCitation } from "@/lib/ask-types";

/**
 * A single source record resolved for scoped Ask, with its text already chunked
 * into retrievable passages. When `hasFullText` is false we only have the
 * record's own metadata to work with (no primary-source body was available).
 */
export interface ScopedSource {
  label: string;
  citation: AskSentinelCitation;
  passages: TextChunk[];
  hasFullText: boolean;
  externalUrl?: string;
}

const CHUNK_SIZE = 1400;

/**
 * Split document text into ~CHUNK_SIZE passages on paragraph boundaries so
 * each passage stays a coherent unit (a clause, a subsection) rather than a
 * mid-sentence cut. Oversized paragraphs are hard-split as a fallback.
 */
function chunkText(text: string, idPrefix: string): TextChunk[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];

  const paras = clean.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const passages: TextChunk[] = [];
  let buf = "";

  const flush = () => {
    const t = buf.trim();
    if (t) passages.push({ id: `${idPrefix}#p${passages.length}`, index: passages.length, text: t });
    buf = "";
  };

  for (const para of paras) {
    if (para.length > CHUNK_SIZE) {
      flush();
      for (let i = 0; i < para.length; i += CHUNK_SIZE) {
        buf = para.slice(i, i + CHUNK_SIZE);
        flush();
      }
      continue;
    }
    if (buf && (buf.length + para.length + 2) > CHUNK_SIZE) flush();
    buf = buf ? `${buf}\n\n${para}` : para;
  }
  flush();

  return passages;
}

/** Resolve a scope request to its source record + chunked passages, or null if not found. */
export async function resolveScope(scope: AskScope): Promise<ScopedSource | null> {
  switch (scope.kind) {
    case "entry":
      return resolveEntry(scope.id);
    case "story":
      return resolveStory(scope.id);
    case "knowledge":
      return resolveKnowledge(scope.id);
    case "signal":
      return resolveSignal(scope.id);
    default:
      return null;
  }
}

/** Resolve every scope in a working set, dropping any that can't be found. */
export async function resolveScopes(scopes: AskScope[]): Promise<ScopedSource[]> {
  const resolved = await Promise.all(scopes.map((s) => resolveScope(s)));
  return resolved.filter((r): r is ScopedSource => r !== null);
}

async function resolveEntry(id: string): Promise<ScopedSource | null> {
  const [row] = db.select().from(entries).where(eq(entries.id, id)).all();
  if (!row) return null;
  const entry = serializeEntry(row);

  // The entry's own analysis is always available as grounding; primary-source
  // documents (the actual legislation text) are layered on top when present.
  const recordText = [
    entry.fullName && entry.fullName !== entry.shortName ? `Full name: ${entry.fullName}` : null,
    entry.summary ? `Summary: ${entry.summary}` : null,
    entry.whyItMatters ? `Why it matters: ${entry.whyItMatters}` : null,
    entry.impactOnUs ? `Impact on us: ${entry.impactOnUs}` : null,
    entry.impactOnCustomers ? `Impact on our customers: ${entry.impactOnCustomers}` : null,
    entry.complianceImplications ? `Compliance implications: ${entry.complianceImplications}` : null,
    entry.notes ? `Notes: ${entry.notes}` : null,
  ].filter(Boolean).join("\n\n");

  const docs = db.select().from(sourceDocuments).where(eq(sourceDocuments.entryId, id)).all();
  const docText = docs
    .filter((d) => d.fullText && d.fullText.trim())
    .map((d) => `# ${d.name}\n\n${d.fullText}`)
    .join("\n\n");

  const passages = chunkText([recordText, docText].filter(Boolean).join("\n\n"), id);
  const externalUrl = entry.sourceUrls?.[0]?.url;

  return {
    label: entry.shortName,
    citation: {
      id: entry.id,
      kind: "tracker",
      title: entry.shortName,
      href: `/tracker/${entry.id}`,
      meta: `${entry.jurisdiction} · ${entry.category} · ${entry.status.replaceAll("_", " ")}`,
      sourceLabel: entry.regulator || "Tracker record",
      externalUrl,
    },
    passages,
    hasFullText: docText.trim().length > 0,
    externalUrl,
  };
}

async function resolveStory(id: string): Promise<ScopedSource | null> {
  const [story] = db.select().from(digestStories).where(eq(digestStories.id, id)).all();
  if (!story) return null;

  const issue = story.issueId
    ? db.select().from(digestIssues).where(eq(digestIssues.id, story.issueId)).all()[0]
    : null;

  const takeaways: string[] = story.takeaways ? JSON.parse(story.takeaways) : [];
  const recordText = [
    `Summary: ${story.summary}`,
    takeaways.length ? `Key takeaways:\n${takeaways.map((t) => `- ${t}`).join("\n")}` : null,
  ].filter(Boolean).join("\n\n");

  // Prefer the article body captured at ingest (reliable, no live fetch). Fall
  // back to a live fetch only when the stored body is missing (older stories),
  // then to the digest's own summary + takeaways.
  let body = story.articleText?.trim() ?? "";
  if (!body && story.url && story.url !== "#") body = await fetchUrlText(story.url);
  const hasFullText = body.trim().length > 200;

  const passages = chunkText([recordText, hasFullText ? body : ""].filter(Boolean).join("\n\n"), id);
  const href = issue ? `/digest/issues/${issue.slug}#${story.id}` : "/digest";

  return {
    label: story.title,
    citation: {
      id: story.id,
      kind: "digest",
      title: story.title,
      href,
      meta: `${story.jurisdiction || "APAC"} · ${story.impact || "Low"} impact`,
      sourceLabel: story.source,
      externalUrl: story.url && story.url !== "#" ? story.url : undefined,
    },
    passages,
    hasFullText,
    externalUrl: story.url && story.url !== "#" ? story.url : undefined,
  };
}

async function resolveKnowledge(id: string): Promise<ScopedSource | null> {
  const [ki] = db.select().from(knowledgeItems).where(eq(knowledgeItems.id, id)).all();
  if (!ki) return null;

  const passages = chunkText(ki.content, `ki:${id}`);
  return {
    label: ki.title,
    citation: {
      id: `ki:${ki.id}`,
      kind: "knowledge",
      title: `${ki.title} [${ki.itemType}]`,
      href: `/library/briefings/${ki.id}`,
      meta: `${ki.jurisdiction || "APAC"} · ${ki.itemType} · ${ki.confidence} confidence`,
      sourceLabel: `Knowledge: ${ki.itemType}`,
    },
    passages,
    hasFullText: ki.content.trim().length > 200,
  };
}

async function resolveSignal(id: string): Promise<ScopedSource | null> {
  const [sig] = db.select().from(signals).where(eq(signals.id, id)).all();
  if (!sig) return null;

  // Signals are short syntheses — the summary is the whole record, so there's
  // no separate primary-source body to chunk against.
  const passages = chunkText(sig.summary, `sig:${id}`);
  const externalUrl = sig.link || undefined;
  return {
    label: sig.title,
    citation: {
      id: `sig:${sig.id}`,
      kind: "signal",
      title: sig.title,
      href: externalUrl || "/",
      meta: `Signal · ${sig.scope} · ${sig.trendDirection} · ${sig.confidence} confidence`,
      sourceLabel: "Sentinel Signal",
      externalUrl,
    },
    passages,
    hasFullText: false,
    externalUrl,
  };
}
