import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { entries, digestStories, knowledgeItems, signals, sourceDocuments } from "@/db/schema";
import { and, eq, ne, like, desc, inArray, isNotNull } from "drizzle-orm";
import type { AskSourceOption } from "@/lib/ask-types";

export const runtime = "nodejs";

const PER_KIND = 6;

/**
 * Search selectable Ask sources across tracked entries, digest stories,
 * knowledge items, and signals. Backs the composer's `@`-mention typeahead and
 * the "Add sources" picker. Returns raw record ids (not the slug-prefixed
 * corpus ids) so they resolve cleanly as AskScope.
 */
export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get("q") || "").trim();
  const term = `%${q}%`;
  const results: AskSourceOption[] = [];

  // Tracked entries (kind "entry") — match on short or full name.
  const entryRows = db
    .select({
      id: entries.id,
      shortName: entries.shortName,
      jurisdiction: entries.jurisdiction,
      category: entries.category,
      status: entries.status,
      type: entries.type,
    })
    .from(entries)
    .where(q ? and(eq(entries.archived, false), like(entries.shortName, term)) : eq(entries.archived, false))
    .orderBy(desc(entries.updatedAt))
    .limit(PER_KIND)
    .all();
  // Pre-flight grounding (Phase 7): what would a scoped ask actually read —
  // the instrument text, supporting docs, or the summary only?
  const grounding = new Map<string, "instrument" | "docs">();
  if (entryRows.length > 0) {
    const docRows = db
      .select({ entryId: sourceDocuments.entryId, role: sourceDocuments.role })
      .from(sourceDocuments)
      .where(
        and(
          inArray(sourceDocuments.entryId, entryRows.map((e) => e.id)),
          isNotNull(sourceDocuments.fullText)
        )
      )
      .all();
    for (const doc of docRows) {
      if (doc.role === "primary_text") grounding.set(doc.entryId, "instrument");
      else if (!grounding.has(doc.entryId)) grounding.set(doc.entryId, "docs");
    }
  }

  for (const e of entryRows) {
    results.push({
      kind: "entry",
      id: e.id,
      title: e.shortName,
      type: e.type,
      meta: `Tracker · ${e.jurisdiction} · ${e.status.replaceAll("_", " ")}`,
      grounding: grounding.get(e.id) ?? "record_only",
    });
  }

  // Digest / news stories (kind "story").
  const storyRows = db
    .select({
      id: digestStories.id,
      title: digestStories.title,
      source: digestStories.source,
      jurisdiction: digestStories.jurisdiction,
    })
    .from(digestStories)
    .where(q ? like(digestStories.title, term) : undefined)
    .orderBy(desc(digestStories.date))
    .limit(PER_KIND)
    .all();
  for (const s of storyRows) {
    results.push({
      kind: "story",
      id: s.id,
      title: s.title,
      meta: `News · ${s.source}${s.jurisdiction ? ` · ${s.jurisdiction}` : ""}`,
    });
  }

  // Knowledge items (kind "knowledge").
  const kiRows = db
    .select({
      id: knowledgeItems.id,
      title: knowledgeItems.title,
      itemType: knowledgeItems.itemType,
      jurisdiction: knowledgeItems.jurisdiction,
    })
    .from(knowledgeItems)
    .where(
      q
        ? and(ne(knowledgeItems.status, "retired"), like(knowledgeItems.title, term))
        : ne(knowledgeItems.status, "retired")
    )
    .orderBy(desc(knowledgeItems.updatedAt))
    .limit(PER_KIND)
    .all();
  for (const k of kiRows) {
    results.push({
      kind: "knowledge",
      id: k.id,
      title: k.title,
      meta: `Knowledge · ${k.itemType}${k.jurisdiction ? ` · ${k.jurisdiction}` : ""}`,
    });
  }

  // Signals (kind "signal").
  const sigRows = db
    .select({
      id: signals.id,
      title: signals.title,
      scope: signals.scope,
      trendDirection: signals.trendDirection,
    })
    .from(signals)
    .where(q ? and(eq(signals.status, "active"), like(signals.title, term)) : eq(signals.status, "active"))
    .orderBy(desc(signals.updatedAt))
    .limit(PER_KIND)
    .all();
  for (const sig of sigRows) {
    results.push({
      kind: "signal",
      id: sig.id,
      title: sig.title,
      meta: `Signal · ${sig.scope} · ${sig.trendDirection}`,
    });
  }

  return NextResponse.json({ sources: results });
}
