import { NextResponse } from "next/server";
import { db } from "@/db";
import { entries, digestStories, digestIssues, knowledgeItems, signals } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { parseJsonField } from "@/lib/utils";
import { getJurisdictionName } from "@/lib/digest-utils";

// One flat, lightweight index for the Cmd+K palette. The whole corpus is a
// few hundred rows, so we ship it once and let the client fuzzy-filter every
// keystroke locally — that's what makes the palette feel instant.

export interface SearchItem {
  id: string;
  kind: "entry" | "story" | "knowledge" | "signal" | "regulator" | "tag";
  title: string;
  subtitle?: string;
  href: string;
  /** extra text the fuzzy matcher should see but the row doesn't display */
  keywords?: string;
  /** jurisdiction code — client renders the flag */
  jurisdiction?: string;
  /** small right-aligned label (status, count) */
  badge?: string;
}

export async function GET() {
  const items: SearchItem[] = [];

  // ── Tracker entries ──────────────────────────────────────────
  const entryRows = await db
    .select({
      id: entries.id,
      shortName: entries.shortName,
      fullName: entries.fullName,
      jurisdiction: entries.jurisdiction,
      category: entries.category,
      status: entries.status,
      regulator: entries.regulator,
      tags: entries.tags,
      aliases: entries.aliases,
      formalCitation: entries.formalCitation,
    })
    .from(entries)
    .where(eq(entries.archived, false))
    .orderBy(desc(entries.updatedAt));

  const regulatorCounts: Record<string, number> = {};
  const trackerTagCounts: Record<string, number> = {};

  for (const e of entryRows) {
    const tags = parseJsonField<string[]>(e.tags) || [];
    const aliases = parseJsonField<string[]>(e.aliases) || [];
    if (e.regulator) regulatorCounts[e.regulator] = (regulatorCounts[e.regulator] || 0) + 1;
    for (const t of tags) trackerTagCounts[t] = (trackerTagCounts[t] || 0) + 1;

    items.push({
      id: `entry:${e.id}`,
      kind: "entry",
      title: e.shortName,
      subtitle: e.category + (e.regulator ? ` · ${e.regulator}` : ""),
      href: `/tracker/${e.id}`,
      keywords: [
        e.fullName,
        e.formalCitation,
        getJurisdictionName(e.jurisdiction),
        e.jurisdiction,
        ...aliases,
        ...tags,
      ]
        .filter(Boolean)
        .join(" "),
      jurisdiction: e.jurisdiction,
      badge: e.status.replace(/_/g, " "),
    });
  }

  // ── Digest stories (all of them, incl. standalone pulse) ────
  const storyRows = await db
    .select({
      id: digestStories.id,
      title: digestStories.title,
      source: digestStories.source,
      date: digestStories.date,
      jurisdiction: digestStories.jurisdiction,
      jurisdictionCode: digestStories.jurisdictionCode,
      categories: digestStories.categories,
      tags: digestStories.tags,
      contentType: digestStories.contentType,
      issueSlug: digestIssues.slug,
    })
    .from(digestStories)
    .leftJoin(digestIssues, eq(digestStories.issueId, digestIssues.id))
    .orderBy(desc(digestStories.date));

  for (const s of storyRows) {
    const categories = parseJsonField<string[]>(s.categories) || [];
    const tags = parseJsonField<string[]>(s.tags) || [];
    items.push({
      id: `story:${s.id}`,
      kind: "story",
      title: s.title,
      subtitle: `${s.source} · ${s.date}`,
      href: s.issueSlug ? `/digest/issues/${s.issueSlug}#${s.id}` : "/digest",
      keywords: [s.jurisdiction, ...categories, ...tags, s.contentType].filter(Boolean).join(" "),
      jurisdiction: s.jurisdictionCode || undefined,
    });
  }

  // ── Library / knowledge items ────────────────────────────────
  const knowledgeRows = await db
    .select({
      id: knowledgeItems.id,
      slug: knowledgeItems.slug,
      title: knowledgeItems.title,
      itemType: knowledgeItems.itemType,
      jurisdiction: knowledgeItems.jurisdiction,
      category: knowledgeItems.category,
      status: knowledgeItems.status,
    })
    .from(knowledgeItems)
    .orderBy(desc(knowledgeItems.updatedAt));

  for (const k of knowledgeRows) {
    if (k.status === "retired") continue;
    const href =
      k.itemType === "topic"
        ? `/library/topics/${k.slug}`
        : k.itemType === "briefing" || k.itemType === "pinned_answer" || k.itemType === "comparison"
          ? `/library/briefings/${k.id}`
          : "/library";
    items.push({
      id: `knowledge:${k.id}`,
      kind: "knowledge",
      title: k.title,
      subtitle: k.itemType.replace(/_/g, " ") + (k.category ? ` · ${k.category}` : ""),
      href,
      keywords: [k.jurisdiction, k.category].filter(Boolean).join(" "),
      jurisdiction: k.jurisdiction || undefined,
    });
  }

  // ── Signals (active) ─────────────────────────────────────────
  const signalRows = await db
    .select({
      id: signals.id,
      title: signals.title,
      scope: signals.scope,
      trendDirection: signals.trendDirection,
      jurisdictions: signals.jurisdictions,
      categories: signals.categories,
      status: signals.status,
    })
    .from(signals)
    .where(eq(signals.status, "active"));

  for (const sg of signalRows) {
    const jurs = parseJsonField<string[]>(sg.jurisdictions) || [];
    const cats = parseJsonField<string[]>(sg.categories) || [];
    items.push({
      id: `signal:${sg.id}`,
      kind: "signal",
      title: sg.title,
      subtitle: `${sg.scope.replace(/-/g, " ")} · ${sg.trendDirection}`,
      href: "/#signals",
      keywords: [...jurs, ...cats].join(" "),
    });
  }

  // ── Regulators (distinct, from tracker entries) ──────────────
  for (const [name, count] of Object.entries(regulatorCounts).sort((a, b) => b[1] - a[1])) {
    items.push({
      id: `regulator:${name}`,
      kind: "regulator",
      title: name,
      href: `/tracker?search=${encodeURIComponent(name)}`,
      badge: `${count} ${count === 1 ? "entry" : "entries"}`,
    });
  }

  // ── Tags (digest tag pages + tracker-only tags) ──────────────
  const digestTagCounts: Record<string, number> = {};
  for (const s of storyRows) {
    if (s.jurisdiction) digestTagCounts[s.jurisdiction] = (digestTagCounts[s.jurisdiction] || 0) + 1;
    for (const cat of parseJsonField<string[]>(s.categories) || []) {
      digestTagCounts[cat] = (digestTagCounts[cat] || 0) + 1;
    }
  }

  // Singleton tags are mostly one-off capture labels; they'd swamp the fuzzy
  // matcher. Their text still matches via the owning items' keywords.
  const seenTags = new Set<string>();
  for (const [name, count] of Object.entries(digestTagCounts).sort((a, b) => b[1] - a[1])) {
    if (count < 2) continue;
    seenTags.add(name.toLowerCase());
    items.push({
      id: `tag:digest:${name}`,
      kind: "tag",
      title: name,
      href: `/digest/tags/${encodeURIComponent(name.toLowerCase())}`,
      badge: `${count}`,
    });
  }
  for (const [name, count] of Object.entries(trackerTagCounts).sort((a, b) => b[1] - a[1])) {
    if (count < 2 || seenTags.has(name.toLowerCase())) continue;
    items.push({
      id: `tag:tracker:${name}`,
      kind: "tag",
      title: name,
      href: `/tracker?search=${encodeURIComponent(name)}`,
      badge: `${count}`,
    });
  }

  return NextResponse.json({ items, generatedAt: new Date().toISOString() });
}
