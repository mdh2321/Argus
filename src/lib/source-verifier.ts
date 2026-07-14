import "server-only";

import Anthropic from "@anthropic-ai/sdk";

// Match check — the verification primitive of the intake pipeline. Given a
// fetched document and the tracker entry it's meant to ground, a cheap model
// pass answers: is this actually that instrument (or official material about
// it)? Right jurisdiction? Current consolidation rather than a superseded
// compilation or the bill that preceded it?
//
// This substitutes for what commercial regulatory trackers get from licensed
// primary-source feeds: we fetch from the open web, so every document's
// identity must be proven before it can ground an analysis.

const client = new Anthropic();
const MODEL = "claude-haiku-4-5-20251001";

// Titles, citations, enactment formulas and version notes live at the top of
// legal documents; 12k chars is plenty to identify one without paying to read
// the whole Act.
const TEXT_SAMPLE_CHARS = 12_000;

export type MatchVerdict = "verified" | "rejected" | "uncertain";

export interface MatchCheckResult {
  verdict: MatchVerdict;
  /** One-line, human-readable reason — shown verbatim in the provenance UI. */
  evidence: string;
  /** 'primary_text' when the doc IS the instrument; 'supporting' otherwise. */
  suggestedRole: "primary_text" | "supporting";
}

export interface MatchCheckEntry {
  shortName: string;
  fullName: string | null;
  formalCitation: string | null;
  jurisdiction: string;
  type: string;
  regulator: string | null;
}

export interface MatchCheckDocument {
  url: string;
  title: string | null;
  fullText: string;
}

export async function verifySourceMatch(
  entry: MatchCheckEntry,
  doc: MatchCheckDocument
): Promise<MatchCheckResult> {
  const sample = doc.fullText.slice(0, TEXT_SAMPLE_CHARS);

  const prompt = `You are verifying a fetched document against a regulatory tracker entry.

TRACKER ENTRY (what we believe we are tracking):
- Name: ${entry.shortName}
- Full name: ${entry.fullName ?? "(unknown)"}
- Formal citation: ${entry.formalCitation ?? "(unknown)"}
- Jurisdiction: ${entry.jurisdiction}
- Instrument type: ${entry.type}
${entry.regulator ? `- Regulator: ${entry.regulator}` : ""}

FETCHED DOCUMENT:
- URL: ${doc.url}
- Page title: ${doc.title ?? "(none)"}
- Text (first ${TEXT_SAMPLE_CHARS.toLocaleString()} chars):
"""
${sample}
"""

Decide which ONE of these describes the document:

A. It IS the instrument — the official text (or official current compilation/consolidation) of the instrument named in the entry, in the entry's jurisdiction.
B. It is OFFICIAL SUPPORTING MATERIAL about that instrument — regulator guidance, explanatory memorandum, official summary page, consultation paper for it.
C. It is the WRONG VERSION — a superseded compilation, the bill where the entry tracks the enacted Act (or vice versa), or a repealed text.
D. It is a DIFFERENT instrument, wrong jurisdiction, or commentary/news that merely mentions the entry.
E. CANNOT TELL — the text is too thin, navigational boilerplate, or ambiguous.

Rules:
- Be strict about identity: a similarly-named Act from another jurisdiction is D, not A.
- For A, prefer evidence from the text itself (title, citation, enactment formula, "compilation as at" notes) over the URL.
- If the text shows a compilation/version date, include it in your evidence.
- Answer with ONLY a JSON object, no code fences:
{"classification": "A|B|C|D|E", "evidence": "<one sentence, max 160 chars, citing the concrete signal you used>"}`;

  let text = "";
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 300,
      messages: [{ role: "user", content: prompt }],
    });
    text = response.content[0]?.type === "text" ? response.content[0].text : "";
  } catch (err) {
    return {
      verdict: "uncertain",
      evidence: `Match check failed to run: ${err instanceof Error ? err.message : String(err)}`,
      suggestedRole: "supporting",
    };
  }

  const cleaned = text.replace(/```(?:json)?\s*/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return {
      verdict: "uncertain",
      evidence: "Match check returned an unreadable response",
      suggestedRole: "supporting",
    };
  }

  let classification = "";
  let evidence = "";
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as {
      classification?: string;
      evidence?: string;
    };
    classification = (parsed.classification ?? "").trim().toUpperCase();
    evidence = (parsed.evidence ?? "").trim().slice(0, 300);
  } catch {
    return {
      verdict: "uncertain",
      evidence: "Match check returned malformed JSON",
      suggestedRole: "supporting",
    };
  }

  switch (classification) {
    case "A":
      return { verdict: "verified", evidence, suggestedRole: "primary_text" };
    case "B":
      return { verdict: "verified", evidence, suggestedRole: "supporting" };
    case "C":
    case "D":
      return { verdict: "rejected", evidence, suggestedRole: "supporting" };
    default:
      return {
        verdict: "uncertain",
        evidence: evidence || "Document could not be confidently identified",
        suggestedRole: "supporting",
      };
  }
}
