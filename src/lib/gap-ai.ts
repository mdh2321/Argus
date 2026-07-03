import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/db";
import { entries, digestStories, gapSuggestions } from "@/db/schema";
import { eq, and, isNull, gte } from "drizzle-orm";
import { generateId, now, parseJsonField, toJsonString } from "@/lib/utils";
import { getProfileContext } from "@/lib/profile-context";
import { JURISDICTIONS, CATEGORIES, TRACKABLE_ENTRY_TYPES } from "@/lib/constants";
import type { GapSuggestion, GapSuggestionSource } from "@/lib/types";

const client = new Anthropic();
const MODEL = "claude-sonnet-4-6";
const LOOKBACK_DAYS = 60;

const VALID_JURISDICTIONS = new Set(JURISDICTIONS.map((j) => j.code));
const VALID_CATEGORIES = new Set<string>(CATEGORIES);
const VALID_SUGGESTABLE_TYPES = new Set<string>(TRACKABLE_ENTRY_TYPES);

export function serializeGapSuggestion(
  row: typeof gapSuggestions.$inferSelect,
  extras?: { sourceStoryTitle?: string | null }
): GapSuggestion {
  return {
    id: row.id,
    suggestedShortName: row.suggestedShortName,
    suggestedFullName: row.suggestedFullName,
    suggestedJurisdiction: row.suggestedJurisdiction,
    suggestedCategory: row.suggestedCategory,
    suggestedType: row.suggestedType,
    suggestedRegulator: row.suggestedRegulator,
    rationale: row.rationale,
    sourceStoryId: row.sourceStoryId,
    sourceUrls: parseJsonField<string[]>(row.sourceUrls),
    source: (row.source as GapSuggestionSource) ?? "digest",
    status: row.status as GapSuggestion["status"],
    acceptedEntryId: row.acceptedEntryId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    sourceStoryTitle: extras?.sourceStoryTitle ?? null,
  };
}

/**
 * Read digest stories from the last N days that have no linked tracker entry,
 * alongside the current tracker, and ask Claude to propose canonical entries
 * worth adding to the tracker — with a short rationale per suggestion.
 *
 * Replaces existing pending suggestions with the new set.
 */
export async function generateGapSuggestions(): Promise<GapSuggestion[]> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400000)
    .toISOString()
    .split("T")[0];

  const untrackedStories = db
    .select()
    .from(digestStories)
    .where(
      and(
        isNull(digestStories.trackerEntryId),
        gte(digestStories.date, since)
      )
    )
    .all();

  if (untrackedStories.length === 0) {
    // Clear stale pending digest suggestions only — scan suggestions are owned by a different pipeline.
    db.delete(gapSuggestions)
      .where(and(eq(gapSuggestions.status, "pending"), eq(gapSuggestions.source, "digest")))
      .run();
    return [];
  }

  const existingEntries = db
    .select({
      shortName: entries.shortName,
      fullName: entries.fullName,
      jurisdiction: entries.jurisdiction,
    })
    .from(entries)
    .where(eq(entries.archived, false))
    .all();

  const profileContext = await getProfileContext();

  const storyContext = untrackedStories
    .map(
      (s) =>
        `[${s.id}] ${s.title} (${s.jurisdictionCode || "?"}, ${s.date}) — ${s.summary?.slice(0, 200) || ""}`
    )
    .join("\n");

  const existingContext = existingEntries
    .map((e) => `- ${e.shortName} (${e.jurisdiction})`)
    .join("\n");

  const prompt = `You are a legal intelligence analyst reviewing recent news for canonical laws or regulations that SHOULD be in the tracker but are not.

${profileContext ? `USER CONTEXT:\n${profileContext}\n\n` : ""}The tracker is the canonical source of truth for laws, bills, regulations, and binding guidance that the user actively monitors. Court decisions, enforcement actions, and interpretive guidance (advisory material explaining how a regulator views existing law) are NOT tracked as standalone entries — they are events about the underlying law.

EXISTING TRACKER ENTRIES (do NOT re-suggest these):
${existingContext || "(none)"}

RECENT DIGEST STORIES (last ${LOOKBACK_DAYS} days) with NO linked tracker entry:
${storyContext}

Task: identify 0-6 SPECIFIC, NAMED laws/bills/regulations/enforcement actions referenced across these stories that are worth adding to the tracker. Cluster multiple stories about the same law into ONE suggestion.

Rules:
- Only suggest things that are NAMED, canonical legal items (e.g. "Privacy Act Amendment Bill 2026", "MAS Cyber Hygiene Notice"). Skip vague topics or generic commentary.
- Do NOT suggest anything already in the existing tracker.
- Prefer items relevant to the user's profile if provided.
- If nothing concrete qualifies, return an empty array.

Valid jurisdictions: ${JURISDICTIONS.map((j) => j.code).join(", ")}
Valid categories: ${CATEGORIES.join(" | ")}
Valid types (must be one of): ${Array.from(VALID_SUGGESTABLE_TYPES).join(", ")}

Respond with ONLY valid JSON:
{
  "suggestions": [
    {
      "shortName": "Privacy Act Amendment Bill 2026",
      "fullName": "Privacy Amendment (Tranche 2) Bill 2026",
      "jurisdiction": "AU",
      "category": "Privacy & Data Protection",
      "type": "bill",
      "regulator": "OAIC",
      "rationale": "One-sentence explanation of why this belongs in the tracker, ideally referencing user profile if known.",
      "sourceStoryId": "story-id-from-above",
      "sourceUrls": ["https://...canonical-source..."]
    }
  ]
}`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    messages: [{ role: "user", content: prompt }],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  let parsed: {
    suggestions: Array<{
      shortName?: string;
      fullName?: string;
      jurisdiction?: string;
      category?: string;
      type?: string;
      regulator?: string;
      rationale?: string;
      sourceStoryId?: string;
      sourceUrls?: string[];
    }>;
  };
  try {
    parsed = JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Model returned non-JSON");
    parsed = JSON.parse(match[0]);
  }

  // Clear pending digest suggestions only — full refresh of the digest-mined slice.
  db.delete(gapSuggestions)
    .where(and(eq(gapSuggestions.status, "pending"), eq(gapSuggestions.source, "digest")))
    .run();

  const timestamp = now();
  const storyById = new Map(untrackedStories.map((s) => [s.id, s]));
  const created: GapSuggestion[] = [];

  for (const sug of parsed.suggestions || []) {
    if (!sug.shortName || !sug.rationale) continue;
    const jurisdiction = (sug.jurisdiction || "").toUpperCase();
    if (!VALID_JURISDICTIONS.has(jurisdiction as (typeof JURISDICTIONS)[number]["code"])) continue;
    if (!sug.category || !VALID_CATEGORIES.has(sug.category)) continue;
    const type = sug.type && VALID_SUGGESTABLE_TYPES.has(sug.type)
      ? sug.type
      : null;
    if (!type) continue; // skip suggestions that aren't one of the trackable types

    const id = generateId();
    db.insert(gapSuggestions)
      .values({
        id,
        suggestedShortName: sug.shortName.slice(0, 200),
        suggestedFullName: sug.fullName || null,
        suggestedJurisdiction: jurisdiction,
        suggestedCategory: sug.category,
        suggestedType: type,
        suggestedRegulator: sug.regulator || null,
        rationale: sug.rationale.slice(0, 500),
        sourceStoryId: sug.sourceStoryId && storyById.has(sug.sourceStoryId)
          ? sug.sourceStoryId
          : null,
        sourceUrls: toJsonString(
          (sug.sourceUrls || []).filter((u) => typeof u === "string" && u.startsWith("http"))
        ),
        source: "digest",
        status: "pending",
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();

    const [row] = db
      .select()
      .from(gapSuggestions)
      .where(eq(gapSuggestions.id, id))
      .all();
    if (row) {
      const story = row.sourceStoryId ? storyById.get(row.sourceStoryId) : undefined;
      created.push(serializeGapSuggestion(row, { sourceStoryTitle: story?.title ?? null }));
    }
  }

  return created;
}
