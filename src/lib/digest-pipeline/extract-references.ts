import Anthropic from "@anthropic-ai/sdk";
import { distance } from "fastest-levenshtein";
import { db } from "@/db";
import { entries, storyReferences, digestStories } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { generateId, now, parseJsonField, toJsonString } from "@/lib/utils";
import { CATEGORIES, JURISDICTIONS, TRACKABLE_ENTRY_TYPES } from "@/lib/constants";

const anthropic = new Anthropic();
const MODEL = "claude-haiku-4-5-20251001";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ExistingEntrySnapshot {
  id: string;
  shortName: string;
  fullName: string;
  jurisdiction: string;
  type: string;
  aliases: string[];
}

interface RawReference {
  text: string;
  classification: string; // legislation | bill | regulation | binding-guidance | interpretive-guidance
  proposed_short_name?: string;
  proposed_full_name?: string;
  proposed_jurisdiction?: string;
  proposed_regulator?: string;
  proposed_category?: string;
  match_entry_id?: string | null;
  match_confidence?: number | null;
  parent_law?: {
    text?: string;
    proposed_short_name?: string;
    proposed_full_name?: string;
    proposed_jurisdiction?: string;
    proposed_regulator?: string;
    proposed_category?: string;
    match_entry_id?: string | null;
  } | null;
}

interface ResolvedReference {
  text: string;
  charStart: number;
  charEnd: number;
  entryId: string | null;
  proposedShortName: string | null;
  proposedFullName: string | null;
  proposedJurisdiction: string | null;
  proposedType: string | null;
  proposedRegulator: string | null;
  proposedCategory: string | null;
  parentProposalJson: string | null; // JSON of original parent_law payload, when applicable
  matchConfidence: number | null;
  status: "matched" | "unmatched";
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Extract trackable references from a single digest story's summary, resolve
 * them against existing tracker entries, and write rows to story_references.
 *
 * Replaces any existing references for that story (idempotent).
 *
 * Returns the resolved references that were written.
 */
export async function extractReferencesForStory(
  storyId: string
): Promise<ResolvedReference[]> {
  const story = db
    .select()
    .from(digestStories)
    .where(eq(digestStories.id, storyId))
    .limit(1)
    .all()[0];

  if (!story) throw new Error(`Story not found: ${storyId}`);
  if (!story.summary || story.summary.trim().length === 0) return [];

  const existing = loadExistingEntries();

  const raw = await callExtractionModel({
    summary: story.summary,
    storyJurisdiction: story.jurisdictionCode ?? null,
    storyCategories: parseJsonField<string[]>(story.categories) ?? [],
    existingEntries: existing,
  });

  const resolved = raw
    .map((r) => resolveReference(r, story.summary, existing))
    .filter((r): r is ResolvedReference => r !== null);

  // Replace existing references for this story.
  const ts = now();
  db.delete(storyReferences).where(eq(storyReferences.storyId, storyId)).run();
  for (const ref of resolved) {
    db.insert(storyReferences)
      .values({
        id: generateId(),
        storyId,
        entryId: ref.entryId,
        text: ref.text,
        charStart: ref.charStart,
        charEnd: ref.charEnd,
        proposedShortName: ref.proposedShortName,
        proposedFullName: ref.proposedFullName,
        proposedJurisdiction: ref.proposedJurisdiction,
        proposedType: ref.proposedType,
        proposedRegulator: ref.proposedRegulator,
        proposedCategory: ref.proposedCategory,
        parentProposal: ref.parentProposalJson,
        matchConfidence: ref.matchConfidence,
        status: ref.status,
        createdAt: ts,
        updatedAt: ts,
      })
      .run();
  }

  return resolved;
}

// ─── Internals ────────────────────────────────────────────────────────────────

function loadExistingEntries(): ExistingEntrySnapshot[] {
  const rows = db
    .select({
      id: entries.id,
      shortName: entries.shortName,
      fullName: entries.fullName,
      jurisdiction: entries.jurisdiction,
      type: entries.type,
      aliases: entries.aliases,
    })
    .from(entries)
    .where(eq(entries.archived, false))
    .all();
  return rows.map((r) => ({
    id: r.id,
    shortName: r.shortName,
    fullName: r.fullName,
    jurisdiction: r.jurisdiction,
    type: r.type,
    aliases: parseJsonField<string[]>(r.aliases) ?? [],
  }));
}

interface ModelInput {
  summary: string;
  storyJurisdiction: string | null;
  storyCategories: string[];
  existingEntries: ExistingEntrySnapshot[];
}

async function callExtractionModel(input: ModelInput): Promise<RawReference[]> {
  const existingBlock = input.existingEntries
    .map((e) => {
      const aliasPart = e.aliases.length > 0 ? ` (aliases: ${e.aliases.join(", ")})` : "";
      return `- [${e.id}] ${e.shortName} | ${e.fullName} | ${e.jurisdiction} | ${e.type}${aliasPart}`;
    })
    .join("\n");

  const trackableTypes = TRACKABLE_ENTRY_TYPES.join(", ");

  const prompt = `You are extracting references to specific, named legal instruments from a digest news story.

A reference is a span of text in the story summary that names a SPECIFIC piece of legislation, regulation, or binding guidance. Generic mentions of legal topics ("AI regulation", "data protection laws") are NOT references — only named instruments are.

The story is from ${input.storyJurisdiction ?? "unknown jurisdiction"}, categories: ${input.storyCategories.join(", ") || "n/a"}.

STORY SUMMARY:
"""
${input.summary}
"""

EXISTING TRACKER ENTRIES (for matching, do NOT propose duplicates):
${existingBlock || "(none)"}

CLASSIFICATION RULES:
- \`legislation\` — enacted statutes/acts (e.g. "Privacy Act 1988", "Online Safety Act 2021").
- \`bill\` — proposed legislation before parliament (e.g. "Privacy Amendment Bill 2024").
- \`regulation\` — subordinate/delegated legislation made under a statute (e.g. "DPDP Rules 2025", "SEC Rule 10b-5").
- \`binding-guidance\` — regulator instruments issued under statutory authority that carry enforcement weight (e.g. "APRA CPS 234", "MAS Notice 626"). Default for guidance documents that ARE enforceable.
- \`interpretive-guidance\` — advisory material that explains how a regulator views existing law without binding force (e.g. "OAIC's APP Guidelines on de-identification"). When in doubt between binding and interpretive, prefer interpretive-guidance.

EXCLUSIONS — do NOT extract:
- Court cases / judgments (e.g. "ACMA v X", "Privacy Commissioner v Y")
- Enforcement actions (specific incidents with named parties)
- Generic topics ("AI rules", "consent requirements", "the Privacy Commissioner")
- Regulators or agencies as standalone references

INTERPRETIVE-GUIDANCE HANDLING:
If a reference is interpretive-guidance, attempt to identify the parent legislation it interprets. Set \`parent_law\` to the parent's metadata. The reference's \`text\` is the literal guidance text in the summary; \`parent_law\` carries the actual trackable subject.
If no parent law can be identified from context, omit the reference entirely.

MATCHING:
For each reference (or each parent_law), check if it matches an existing entry. A match means the same legal instrument in the same jurisdiction. If you can match it confidently, set \`match_entry_id\` to the entry's [id]. If unsure, leave \`match_entry_id\` null and provide proposed_* fields so the entry can be created.

Return ONLY valid JSON (no commentary, no fences):
{
  "references": [
    {
      "text": "exact substring of the summary, including any leading 'the' if present",
      "classification": "legislation | bill | regulation | binding-guidance | interpretive-guidance",
      "proposed_short_name": "Privacy Amendment Bill 2024",
      "proposed_full_name": "Privacy Amendment (Tranche 2) Bill 2024",
      "proposed_jurisdiction": "AU",
      "proposed_regulator": "OAIC",
      "proposed_category": "Privacy & Data Protection",
      "match_entry_id": null,
      "match_confidence": null,
      "parent_law": null
    }
  ]
}

For interpretive-guidance, parent_law has the same shape as a top-level reference (proposed_*, match_entry_id), and the reference's own classification stays "interpretive-guidance".

VALIDATION HINTS:
- proposed_jurisdiction MUST be one of: ${JURISDICTIONS.map((j) => j.code).join(", ")}
- proposed_category MUST be one of: ${CATEGORIES.join(" | ")}
- For trackable references (non-interpretive), classification MUST be one of: ${trackableTypes}
- The \`text\` field MUST be a substring that appears verbatim in the summary above. If the summary uses an abbreviated form ("the Act", "the Bill") the reference is acceptable as long as the text matches what's in the summary.
- Return an empty array if no references qualify. Better to under-extract than over-extract.`;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2000,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  return parseReferences(text);
}

function parseReferences(text: string): RawReference[] {
  const cleaned = text.replace(/```(?:json)?\s*/g, "").replace(/```\s*$/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < 0) return [];
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as { references?: RawReference[] };
    return Array.isArray(parsed.references) ? parsed.references : [];
  } catch {
    return [];
  }
}

function resolveReference(
  raw: RawReference,
  summary: string,
  existing: ExistingEntrySnapshot[]
): ResolvedReference | null {
  // Find the literal text in the summary. The reference is invalid if absent.
  const idx = summary.indexOf(raw.text);
  if (idx < 0) return null;

  const charStart = idx;
  const charEnd = idx + raw.text.length;

  const validTrackable = new Set<string>(TRACKABLE_ENTRY_TYPES);

  // For interpretive-guidance, use parent_law as the trackable subject.
  if (raw.classification === "interpretive-guidance") {
    const parent = raw.parent_law;
    if (!parent) return null; // no parent identified — skip
    const parentMatch = matchAgainstExisting(
      {
        text: parent.text ?? raw.text,
        proposed_short_name: parent.proposed_short_name,
        proposed_full_name: parent.proposed_full_name,
        proposed_jurisdiction: parent.proposed_jurisdiction,
        match_entry_id: parent.match_entry_id ?? null,
      },
      existing
    );
    return {
      text: raw.text,
      charStart,
      charEnd,
      entryId: parentMatch.entryId,
      proposedShortName: parent.proposed_short_name ?? null,
      proposedFullName: parent.proposed_full_name ?? null,
      proposedJurisdiction: parent.proposed_jurisdiction ?? null,
      // We don't know the parent's type without resolving — default to legislation as the most common parent.
      proposedType: parentMatch.entryId ? null : "legislation",
      proposedRegulator: parent.proposed_regulator ?? null,
      proposedCategory: parent.proposed_category ?? null,
      parentProposalJson: toJsonString({
        guidanceText: raw.text,
        parent: parent,
      }),
      matchConfidence: parentMatch.confidence,
      status: parentMatch.entryId ? "matched" : "unmatched",
    };
  }

  // Trackable types: classification must be in TRACKABLE_ENTRY_TYPES.
  if (!validTrackable.has(raw.classification)) return null;

  const result = matchAgainstExisting(raw, existing);
  return {
    text: raw.text,
    charStart,
    charEnd,
    entryId: result.entryId,
    proposedShortName: raw.proposed_short_name ?? null,
    proposedFullName: raw.proposed_full_name ?? null,
    proposedJurisdiction: raw.proposed_jurisdiction ?? null,
    proposedType: raw.classification,
    proposedRegulator: raw.proposed_regulator ?? null,
    proposedCategory: raw.proposed_category ?? null,
    parentProposalJson: null,
    matchConfidence: result.confidence,
    status: result.entryId ? "matched" : "unmatched",
  };
}

interface MatchableInput {
  text: string;
  proposed_short_name?: string;
  proposed_full_name?: string;
  proposed_jurisdiction?: string;
  match_entry_id?: string | null;
}

function matchAgainstExisting(
  input: MatchableInput,
  existing: ExistingEntrySnapshot[]
): { entryId: string | null; confidence: number | null } {
  // 1. Trust the model's match if it picked a valid existing entry.
  if (input.match_entry_id) {
    const hit = existing.find((e) => e.id === input.match_entry_id);
    if (hit) return { entryId: hit.id, confidence: 1.0 };
  }

  // 2. Code-side fuzzy match, jurisdiction-filtered when possible.
  const targets = (() => {
    const byJur = input.proposed_jurisdiction
      ? existing.filter((e) => e.jurisdiction === input.proposed_jurisdiction)
      : existing;
    return byJur.length > 0 ? byJur : existing;
  })();

  const candidates: string[] = [
    input.proposed_short_name,
    input.proposed_full_name,
    input.text,
  ].filter((s): s is string => typeof s === "string" && s.trim().length > 0);

  if (candidates.length === 0 || targets.length === 0) {
    return { entryId: null, confidence: null };
  }

  let bestEntry: ExistingEntrySnapshot | null = null;
  let bestRatio = 0;

  for (const e of targets) {
    const eNames = [e.shortName, e.fullName, ...e.aliases].filter(Boolean);
    for (const candidate of candidates) {
      for (const eName of eNames) {
        const ratio = similarityRatio(candidate, eName);
        if (ratio > bestRatio) {
          bestRatio = ratio;
          bestEntry = e;
        }
      }
    }
  }

  // Threshold: 0.85 for confident match. Below that, treat as unmatched.
  if (bestEntry && bestRatio >= 0.85) {
    return { entryId: bestEntry.id, confidence: bestRatio };
  }
  return { entryId: null, confidence: bestRatio || null };
}

function similarityRatio(a: string, b: string): number {
  const an = normalize(a);
  const bn = normalize(b);
  if (an === bn) return 1.0;
  const maxLen = Math.max(an.length, bn.length);
  if (maxLen === 0) return 0;
  const d = distance(an, bn);
  return 1 - d / maxLen;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Re-export for downstream callers that need the type.
export type { ResolvedReference };

// ─── Read helpers ─────────────────────────────────────────────────────────────

export interface SerializedReference {
  id: string;
  storyId: string;
  entryId: string | null;
  text: string;
  charStart: number;
  charEnd: number;
  proposedShortName: string | null;
  proposedFullName: string | null;
  proposedJurisdiction: string | null;
  proposedType: string | null;
  proposedRegulator: string | null;
  proposedCategory: string | null;
  matchConfidence: number | null;
  status: "matched" | "unmatched" | "dismissed";
}

export function loadReferencesByStoryIds(storyIds: string[]): Map<string, SerializedReference[]> {
  const out = new Map<string, SerializedReference[]>();
  if (storyIds.length === 0) return out;

  const rows = db
    .select()
    .from(storyReferences)
    .where(inArray(storyReferences.storyId, storyIds))
    .all();

  for (const r of rows) {
    const list = out.get(r.storyId) ?? [];
    list.push({
      id: r.id,
      storyId: r.storyId,
      entryId: r.entryId,
      text: r.text,
      charStart: r.charStart,
      charEnd: r.charEnd,
      proposedShortName: r.proposedShortName,
      proposedFullName: r.proposedFullName,
      proposedJurisdiction: r.proposedJurisdiction,
      proposedType: r.proposedType,
      proposedRegulator: r.proposedRegulator,
      proposedCategory: r.proposedCategory,
      matchConfidence: r.matchConfidence,
      status: (r.status as SerializedReference["status"]) ?? "unmatched",
    });
    out.set(r.storyId, list);
  }
  // Sort references within a story by charStart for stable rendering.
  for (const [k, v] of out) out.set(k, v.sort((a, b) => a.charStart - b.charStart));
  return out;
}
