import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/db";
import { entries, signals, knowledgeItems, digestStories } from "@/db/schema";
import { eq, and, gte, ne } from "drizzle-orm";
import { generateId, now, parseJsonField, toJsonString } from "@/lib/utils";
import { serializeEntry } from "@/lib/entry-helpers";
import { getProfileContext } from "@/lib/profile-context";
import type { Signal } from "@/lib/types";

const client = new Anthropic();
const MODEL = "claude-sonnet-4-6";

export function serializeSignal(row: typeof signals.$inferSelect): Signal {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    scope: row.scope as Signal["scope"],
    trendDirection: row.trendDirection as Signal["trendDirection"],
    confidence: row.confidence as Signal["confidence"],
    sourceEntryIds: parseJsonField<string[]>(row.sourceEntryIds),
    sourceKnowledgeIds: parseJsonField<string[]>(row.sourceKnowledgeIds),
    sourceDigestStoryIds: parseJsonField<string[]>(row.sourceDigestStoryIds),
    jurisdictions: parseJsonField<string[]>(row.jurisdictions),
    categories: parseJsonField<string[]>(row.categories),
    status: row.status as Signal["status"],
    link: row.link,
    linkLabel: row.linkLabel,
    relevanceScore: row.relevanceScore,
    relevanceRationale: row.relevanceRationale,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function generateSignals(): Promise<Signal[]> {
  // Gather context: entries, recent digest stories, knowledge items
  const allEntries = db
    .select()
    .from(entries)
    .where(eq(entries.archived, false))
    .all()
    .map(serializeEntry);

  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
  // Regulatory stories only — Industry Intel / pulse items are excluded from
  // trend synthesis (refinement plan B2).
  const recentStories = db
    .select()
    .from(digestStories)
    .where(
      and(
        gte(digestStories.date, thirtyDaysAgo.split("T")[0]),
        eq(digestStories.contentType, "regulatory")
      )
    )
    .all();

  const activeKnowledge = db
    .select()
    .from(knowledgeItems)
    .where(and(ne(knowledgeItems.status, "retired")))
    .all();

  // Build context for the prompt
  const entryContext = allEntries
    .map(
      (e) =>
        `[${e.id}] ${e.shortName} (${e.jurisdiction}, ${e.status}, impact:${e.impactScore || "?"}) — ${e.category}${e.summary ? `: ${e.summary.slice(0, 200)}` : ""}`
    )
    .join("\n");

  const digestContext = recentStories
    .map(
      (s) =>
        `[${s.id}] ${s.title} (${s.jurisdictionCode || "?"}, ${s.impact || "?"}, ${s.date}) — ${s.summary?.slice(0, 200) || ""}`
    )
    .join("\n");

  const knowledgeContext = activeKnowledge
    .map(
      (k) =>
        `[${k.id}] ${k.title} (${k.itemType}, ${k.jurisdiction || "multi"}) — confidence:${k.confidence}`
    )
    .join("\n");

  const profileContext = await getProfileContext();

  const prompt = `You are a legal intelligence analyst synthesising medium-term trends across Asia-Pacific regulatory developments.

${profileContext ? `USER CONTEXT:\n${profileContext}\n\n` : ""}Based on the tracker entries, recent digest stories, and knowledge items below, identify 3-5 cross-cutting signals — strategic themes or patterns that emerge from multiple data points.

A signal is NOT a single event. It is a synthesised observation about a trend, convergence, divergence, or acceleration across jurisdictions or legal domains.

Examples of good signals:
- "APAC privacy enforcement is hardening" (supported by multiple enforcement actions across jurisdictions)
- "AI governance frameworks converging on mandatory obligations" (multiple jurisdictions moving from voluntary to mandatory)
- "Cross-border data transfer scrutiny increasing" (adequacy assessments, new transfer mechanisms)

TRACKER ENTRIES (${allEntries.length} total):
${entryContext || "(none)"}

RECENT DIGEST STORIES (last 30 days, ${recentStories.length} total):
${digestContext || "(none)"}

KNOWLEDGE ITEMS (${activeKnowledge.length} total):
${knowledgeContext || "(none)"}

For EACH signal, also produce:
- "relevanceScore": integer 0-100 scoring how relevant THIS signal is to the USER CONTEXT above (0 = irrelevant, 100 = bullseye). If no user context is provided, use 50.
- "relevanceRationale": one concise sentence (≤160 chars) explaining WHY this signal matters for this specific user, referencing their sectors/products/jurisdictions where possible. If no user context, give a generic one-line "why it matters".

Respond with ONLY valid JSON in this format:
{
  "signals": [
    {
      "title": "Short signal headline",
      "summary": "2-3 sentence explanation of the trend and its significance",
      "scope": "cross-jurisdiction" | "single-jurisdiction" | "thematic",
      "trendDirection": "accelerating" | "decelerating" | "stable" | "emerging" | "diverging",
      "confidence": "high" | "medium" | "low",
      "relevanceScore": 85,
      "relevanceRationale": "Directly affects your SG data-transfer flows for the payments product.",
      "sourceEntryIds": ["entry-id-1", "entry-id-2"],
      "sourceKnowledgeIds": ["ki-id-1"],
      "sourceDigestStoryIds": ["story-id-1"],
      "jurisdictions": ["AU", "SG", "JP"],
      "categories": ["Privacy & Data Protection"],
      "link": "/tracker?category=Privacy+%26+Data+Protection",
      "linkLabel": "View entries"
    }
  ]
}

Only reference IDs that actually appear in the data above. If data is sparse, generate fewer signals rather than speculating.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    messages: [{ role: "user", content: prompt }],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";
  const parsed = JSON.parse(text) as {
    signals: Array<{
      title: string;
      summary: string;
      scope: string;
      trendDirection: string;
      confidence: string;
      relevanceScore?: number;
      relevanceRationale?: string;
      sourceEntryIds?: string[];
      sourceKnowledgeIds?: string[];
      sourceDigestStoryIds?: string[];
      jurisdictions?: string[];
      categories?: string[];
      link?: string;
      linkLabel?: string;
    }>;
  };

  // Mark previous active signals as stale
  const timestamp = now();
  db.update(signals)
    .set({ status: "stale", updatedAt: timestamp })
    .where(eq(signals.status, "active"))
    .run();

  // Insert new signals
  const created: Signal[] = [];
  for (const sig of parsed.signals) {
    const id = generateId();
    const relevanceScore =
      typeof sig.relevanceScore === "number"
        ? Math.max(0, Math.min(100, Math.round(sig.relevanceScore)))
        : null;
    db.insert(signals)
      .values({
        id,
        title: sig.title,
        summary: sig.summary,
        scope: sig.scope,
        trendDirection: sig.trendDirection,
        confidence: sig.confidence || "medium",
        sourceEntryIds: toJsonString(sig.sourceEntryIds || []),
        sourceKnowledgeIds: toJsonString(sig.sourceKnowledgeIds || []),
        sourceDigestStoryIds: toJsonString(sig.sourceDigestStoryIds || []),
        jurisdictions: toJsonString(sig.jurisdictions || []),
        categories: toJsonString(sig.categories || []),
        status: "active",
        link: sig.link || null,
        linkLabel: sig.linkLabel || null,
        relevanceScore,
        relevanceRationale: sig.relevanceRationale?.trim() || null,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();

    const [row] = db
      .select()
      .from(signals)
      .where(eq(signals.id, id))
      .all();
    if (row) created.push(serializeSignal(row));
  }

  return created;
}
