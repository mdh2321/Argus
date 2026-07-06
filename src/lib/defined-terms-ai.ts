import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/db";
import { definedTerms } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { generateId, now } from "@/lib/utils";

const client = new Anthropic();
// Verbatim definition extraction is mechanical work — Haiku handles it without
// the legal-reasoning tier (H1). Keep Sonnet only for tasks that reason about
// the law (summaries, Ask, artifacts, capture, comparator).
const MODEL = "claude-haiku-4-5-20251001";

// Cap per-doc input. Definitions usually live in early sections of an Act, so
// even a 200K char Act will have its definitions fit comfortably.
const DOC_SLICE = 200000;

export interface ExtractedTerm {
  term: string;
  definition: string;
  sectionRef: string | null;
  scope: "act-wide" | "part-wide" | "section-specific";
}

interface ExtractInput {
  docName: string;
  fullText: string;
}

// Extract defined terms from a single source document. Targets the
// "Definitions" / "Interpretation" section of a piece of legislation.
// Returns an empty array if no definitions section is found.
export async function extractDefinedTerms(
  input: ExtractInput
): Promise<ExtractedTerm[]> {
  const text = input.fullText.slice(0, DOC_SLICE);

  const prompt = `You are a legal text extraction tool. Extract every defined term in this piece of legislation. ONLY extract genuine definitions — not casual uses of a word.

A definition exists when the document EXPLICITLY tells the reader what a term means. The text must use a definitional connector. Typical patterns:
  - "X means ..."
  - "X includes ..."
  - "X refers to ..."
  - "X is ..." (only when followed by a defining clause, not a substantive statement)
  - "X has the meaning given by ..."
  - "In this Act, X means ..."
  - "For the purposes of this Part, X is ..."
  - "X is taken to ..." (when defining a term, not stating an obligation)

A definition can appear:
  - In a dedicated Definitions / Interpretation / Glossary section (most common).
  - Inline inside another Part or Section, scoped to that Part/Section.
  - In a Schedule that lists defined terms.

DO NOT extract:
  - A term that is merely used in the text but never explicitly defined.
  - Section headings, marginal notes, or table-of-contents entries.
  - Substantive obligations or operative provisions ("X must do Y", "X is liable for ...").
  - Examples or notes unless they themselves use a definitional connector.
  - A general statement of fact about something even if it sounds definition-like.

If you are not sure whether a passage is a definition, skip it. False positives are worse than false negatives.

DOCUMENT NAME: ${input.docName}

DOCUMENT TEXT:
${text}

For each definition you find, return:
- "term": the defined word or phrase, exactly as written (preserve case if the Act capitalises it).
- "definition": the verbatim definition text (cap at 600 characters; truncate with "…" if longer).
- "sectionRef": the section / paragraph where the definition lives (e.g. "s 6(1)", "Section 4", "Part 2 s 12", "Schedule 1 cl 2").
- "scope": one of:
    * "act-wide" — applies throughout the Act (typically in the main Definitions section).
    * "part-wide" — defined for a specific Part or Division only.
    * "section-specific" — defined inline within a single section, used only there.

If the document contains no genuine definitions, return an empty array.

Return ONLY valid JSON in this shape:
{
  "terms": [
    {
      "term": "personal information",
      "definition": "information or an opinion about an identified individual...",
      "sectionRef": "s 6(1)",
      "scope": "act-wide"
    }
  ]
}`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    messages: [{ role: "user", content: prompt }],
  });

  const block = response.content.find((b) => b.type === "text");
  const raw = block?.type === "text" ? block.text : "";
  const cleaned = raw
    .replace(/^```(?:json)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();

  let parsed: { terms?: unknown } = {};
  try {
    parsed = JSON.parse(cleaned) as typeof parsed;
  } catch {
    return [];
  }

  if (!Array.isArray(parsed.terms)) return [];

  return parsed.terms
    .map((raw) => normalizeTerm(raw))
    .filter((t): t is ExtractedTerm => t !== null);
}

// Per-document extract + store. Replaces any prior terms for the same doc so
// re-runs are idempotent. Skips silently when fullText is missing or too short
// to plausibly contain a definitions section.
//
// Use this in fire-and-forget background calls after creating a source doc:
//
//   void extractAndStoreTermsForDoc(entryId, doc).catch((err) =>
//     console.error("Background term extraction failed:", err)
//   );
//
// The promise rejects on API errors; callers that don't await must catch.
export async function extractAndStoreTermsForDoc(
  entryId: string,
  doc: { id: string; name: string; fullText: string | null }
): Promise<{ termCount: number; skipped: boolean }> {
  if (!doc.fullText || doc.fullText.length < 200) {
    return { termCount: 0, skipped: true };
  }

  const extracted = await extractDefinedTerms({
    docName: doc.name,
    fullText: doc.fullText,
  });

  // Replace prior extraction for this doc so re-runs don't accumulate dupes.
  await db
    .delete(definedTerms)
    .where(and(eq(definedTerms.sourceDocId, doc.id), eq(definedTerms.entryId, entryId)));

  if (extracted.length === 0) {
    return { termCount: 0, skipped: false };
  }

  const timestamp = now();
  await db.insert(definedTerms).values(
    extracted.map((t) => ({
      id: generateId(),
      sourceDocId: doc.id,
      entryId,
      term: t.term,
      definition: t.definition,
      sectionRef: t.sectionRef,
      scope: t.scope,
      createdAt: timestamp,
      updatedAt: timestamp,
    }))
  );

  return { termCount: extracted.length, skipped: false };
}

function normalizeTerm(raw: unknown): ExtractedTerm | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const term = typeof r.term === "string" ? r.term.trim() : "";
  const definition = typeof r.definition === "string" ? r.definition.trim() : "";
  if (!term || !definition) return null;
  const sectionRef = typeof r.sectionRef === "string" && r.sectionRef.trim()
    ? r.sectionRef.trim()
    : null;
  const scopeRaw = typeof r.scope === "string" ? r.scope : "act-wide";
  const scope: ExtractedTerm["scope"] =
    scopeRaw === "part-wide" || scopeRaw === "section-specific" ? scopeRaw : "act-wide";

  return {
    term: term.slice(0, 200),
    definition: definition.slice(0, 600),
    sectionRef,
    scope,
  };
}
