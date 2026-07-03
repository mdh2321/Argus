import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import { getProfileContext } from "@/lib/profile-context";
import {
  buildSourcesBlock,
  buildTimingBlock,
  callCached,
  normalizeComplianceChecklist,
  normalizeEscalationTriggers,
  normalizeThresholdTests,
  robustJsonParse,
  type SummaryComparator,
  type SummaryDefinedTerm,
  type SummaryKeyDate,
  type SummarySourceDocument,
} from "./summary-ai";
import type {
  ArtifactKind,
  ClaimGrounding,
  ComplianceChecklistItem,
  EntryClaim,
  EntryClaimCitation,
  EscalationTrigger,
  SectionConfidence,
  ThresholdTest,
} from "./types";

// On-demand artifacts. The summary pipeline produces narrative legal analysis;
// these generators each run a single focused prompt for the artifact the user
// asked for. Much faster than the 4-stage summary pipeline (single call, no
// adversarial critique or citation verification) so we can run synchronously
// in the route handler — but they still use the same 5-15 minute maxDuration
// budget to be safe with longer source documents.

// We give the model the existing entry context (summary, applicability,
// key criteria, etc.) so the artifact stays consistent with what's already
// on the page. Without that, "Generate checklist" would produce a checklist
// that contradicts the visible compliance prose.
export interface ArtifactInput {
  shortName: string;
  fullName: string;
  jurisdiction: string;
  category: string;
  type: string;
  status: string;
  regulator: string | null;
  // Existing analysis already on the entry. Pass through whatever's available
  // so the artifact builds on (rather than competes with) the summary.
  existingSummary: string | null;
  existingApplicability: string | null;
  existingKeyCriteria: string | null;
  existingWhyItMatters: string | null;
  existingComplianceImplications: string | null;
  existingExemptions: string | null;
  existingPenalties: string | null;
  sourceDocuments: SummarySourceDocument[];
  definedTerms?: SummaryDefinedTerm[];
  comparators?: SummaryComparator[];
  currentDate?: string;
  keyDates?: SummaryKeyDate[];
}

export interface CrossJurisdictionResult {
  // Plain-text version for the relatedContext field — bullet-formatted prose
  // matching the rest of the page's text sections.
  text: string | null;
  // Structured claims for the sectionClaims.relatedContext slot.
  claims: EntryClaim[];
  // Confidence assessment for the new section.
  confidence: SectionConfidence | null;
}

// Single-shot generation budget. The summary pipeline allocates 32K for its
// thinking-enabled draft pass; we don't need anywhere near that for one
// focused artifact. callCached uses the model configured inside summary-ai.
const MAX_TOKENS = 8000;

// --------------------------------------------------------------------------
// Public dispatch — one entry point per artifact kind. Used by the
// /generate-artifact route so the route stays a thin status-tracking shell.
// --------------------------------------------------------------------------
export async function generateArtifact(
  kind: ArtifactKind,
  input: ArtifactInput
): Promise<unknown> {
  switch (kind) {
    case "complianceChecklist":
      return generateComplianceChecklist(input);
    case "thresholdTests":
      return generateThresholdTests(input);
    case "escalationTriggers":
      return generateEscalationTriggers(input);
    case "crossJurisdictionAnalogues":
      return generateCrossJurisdictionAnalogues(input);
  }
}

// --------------------------------------------------------------------------
// Compliance checklist.
// --------------------------------------------------------------------------
export async function generateComplianceChecklist(
  input: ArtifactInput
): Promise<ComplianceChecklistItem[]> {
  const profileContext = await getProfileContext();
  const sources = buildSourcesBlock(input.sourceDocuments, input.definedTerms, input.comparators);
  const instructions = buildComplianceChecklistInstructions(input, profileContext);

  const response = await callCached({ sources, instructions, maxTokens: MAX_TOKENS });
  const parsed = parseJsonResponse(response);
  const items = Array.isArray((parsed as Record<string, unknown>).items)
    ? (parsed as { items: unknown }).items
    : parsed;
  return normalizeComplianceChecklist(items);
}

function buildComplianceChecklistInstructions(input: ArtifactInput, profileContext: string): string {
  return `You are a senior legal-operations analyst producing a concrete compliance checklist for an in-house team.

${profileContext ? `USER CONTEXT:\n${profileContext}\n\n` : ""}ENTRY:
- Name: ${input.shortName} (${input.jurisdiction})
- Type: ${input.type}, Status: ${input.status}
${input.regulator ? `- Regulator: ${input.regulator}` : ""}

${buildExistingAnalysisBlock(input)}${buildTimingBlock(input.currentDate, input.keyDates)}

The primary source documents are provided in the preceding content block. Use them as ground truth.

YOUR JOB:
Produce a checklist of 3–10 concrete actions a real team member can take to comply with this instrument. Each item must be an action — not a principle, not a summary. Items should be:

- Specific enough that an owner could put them on a sprint board this week.
- Tied to an actual obligation in the source (cite the section ref).
- Owned by a sensible org function (Legal, Security, Engineering, HR, Finance, Privacy, etc.).
- Backed by an evidence artefact (a register entry, a DPIA, a contract clause, an audit log) that demonstrates compliance after the fact.

DO NOT:
- Pad with generic platitudes ("review the regulation", "consult counsel"). If the source doesn't require an action, leave the list short.
- Mix in business-impact analysis or escalation triggers — those are separate artifacts.
- Produce items the source doesn't actually require.

Return ONLY valid JSON in this shape:
{
  "items": [
    { "action": "<concrete required action>", "owner": "<typical org function>", "evidence": "<artefact that demonstrates compliance>", "sectionRef": "<pinpoint cite or null>" }
  ]
}

If the source genuinely doesn't support any compliance actions (e.g. a piece of consultation text with no operative provisions), return { "items": [] }.`;
}

// --------------------------------------------------------------------------
// Threshold tests — yes/no scoping questions.
// --------------------------------------------------------------------------
export async function generateThresholdTests(
  input: ArtifactInput
): Promise<ThresholdTest[]> {
  const profileContext = await getProfileContext();
  const sources = buildSourcesBlock(input.sourceDocuments, input.definedTerms, input.comparators);
  const instructions = buildThresholdTestsInstructions(input, profileContext);

  const response = await callCached({ sources, instructions, maxTokens: MAX_TOKENS });
  const parsed = parseJsonResponse(response);
  const items = Array.isArray((parsed as Record<string, unknown>).items)
    ? (parsed as { items: unknown }).items
    : parsed;
  return normalizeThresholdTests(items);
}

function buildThresholdTestsInstructions(input: ArtifactInput, profileContext: string): string {
  return `You are a regulatory analyst producing an in-scope/out-of-scope decision tree for an in-house team.

${profileContext ? `USER CONTEXT:\n${profileContext}\n\n` : ""}ENTRY:
- Name: ${input.shortName} (${input.jurisdiction})
- Type: ${input.type}, Status: ${input.status}
${input.regulator ? `- Regulator: ${input.regulator}` : ""}

${buildExistingAnalysisBlock(input)}

The primary source documents are provided in the preceding content block.

YOUR JOB:
Produce 2–6 ordered yes/no questions that walk a reader through whether this regulation applies to them. The reader is checking scope before doing any compliance work.

Each question must be:
- Plain-language and answerable from the entry context (no obscure legal terminology unless followed by an inline gloss).
- A genuine threshold — answering it changes whether you're in scope. Don't ask questions whose answer doesn't matter.
- Tied to the source where possible (cite the section ref).
- Sequential — each question should chain to the next, with ifYes / ifNo telling the reader either the next test or a terminal conclusion ("In scope — proceed to compliance checklist", "Out of scope — no further action").

Return ONLY valid JSON in this shape:
{
  "items": [
    { "question": "<plain-language yes/no scoping question>", "sectionRef": "<pinpoint cite or null>", "ifYes": "<what 'yes' means / next step>", "ifNo": "<what 'no' means / next step>" }
  ]
}

If the source genuinely doesn't have operative scope provisions (e.g. it's a consultation paper or pure guidance), return { "items": [] }.`;
}

// --------------------------------------------------------------------------
// Escalation triggers — concrete events that raise urgency.
// --------------------------------------------------------------------------
export async function generateEscalationTriggers(
  input: ArtifactInput
): Promise<EscalationTrigger[]> {
  const profileContext = await getProfileContext();
  const sources = buildSourcesBlock(input.sourceDocuments, input.definedTerms, input.comparators);
  const instructions = buildEscalationTriggersInstructions(input, profileContext);

  const response = await callCached({ sources, instructions, maxTokens: MAX_TOKENS });
  const parsed = parseJsonResponse(response);
  const items = Array.isArray((parsed as Record<string, unknown>).items)
    ? (parsed as { items: unknown }).items
    : parsed;
  return normalizeEscalationTriggers(items);
}

function buildEscalationTriggersInstructions(input: ArtifactInput, profileContext: string): string {
  return `You are a regulatory analyst producing a watch-list of concrete escalation triggers for an in-house team.

${profileContext ? `USER CONTEXT:\n${profileContext}\n\n` : ""}ENTRY:
- Name: ${input.shortName} (${input.jurisdiction})
- Type: ${input.type}, Status: ${input.status}
${input.regulator ? `- Regulator: ${input.regulator}` : ""}

${buildExistingAnalysisBlock(input)}${buildTimingBlock(input.currentDate, input.keyDates)}

The primary source documents are provided in the preceding content block.

YOUR JOB:
Produce 2–6 escalation triggers — each a concrete, observable event that, if it happens, makes compliance with this instrument urgent for the user. Examples of the right shape: "regulator publishes binding guidance under s X", "any breach affecting >1000 AU residents", "company crosses 5,000-record threshold", "any cross-border transfer to a non-adequate jurisdiction".

Each item must be:
- A specific, observable event — not a vague risk factor.
- Tied to a real provision in the source where possible (cite the section ref).
- Paired with a "condition" that tells the user what to do or watch for when it fires.

DO NOT:
- Restate generic compliance principles ("monitor regulator announcements"). The user already monitors. Triggers must be specific to THIS instrument.
- Mix in compliance actions or threshold tests — those are separate artifacts.
- Pad with low-value items. If the source genuinely has fewer than 2 real triggers, return whatever is real.

Return ONLY valid JSON in this shape:
{
  "items": [
    { "trigger": "<concrete event/condition>", "condition": "<what the user should do or watch for>", "sectionRef": "<pinpoint cite or null>" }
  ]
}

If the source genuinely doesn't support any escalation triggers, return { "items": [] }.`;
}

// --------------------------------------------------------------------------
// Cross-jurisdiction analogues — replaces the relatedContext free-text field.
// Returns prose + structured claims so the page can render footnotes the same
// way it does for other claim-grounded sections.
// --------------------------------------------------------------------------
export async function generateCrossJurisdictionAnalogues(
  input: ArtifactInput
): Promise<CrossJurisdictionResult> {
  const profileContext = await getProfileContext();
  const sources = buildSourcesBlock(input.sourceDocuments, input.definedTerms, input.comparators);
  const instructions = buildCrossJurisdictionInstructions(input, profileContext);

  const response = await callCached({ sources, instructions, maxTokens: MAX_TOKENS });
  const parsed = parseJsonResponse(response) as {
    intro?: unknown;
    claims?: unknown;
    confidence?: unknown;
  };

  const intro = typeof parsed.intro === "string" ? parsed.intro.trim() : null;
  const claims = normalizeCrossJurisdictionClaims(parsed.claims, input.sourceDocuments);
  const confidence = normalizeConfidence(parsed.confidence);

  const text = buildSectionText(intro, claims.map((c) => c.text));
  return { text, claims, confidence };
}

function buildCrossJurisdictionInstructions(input: ArtifactInput, profileContext: string): string {
  return `You are a comparative-law analyst situating this instrument against analogues in other jurisdictions.

${profileContext ? `USER CONTEXT:\n${profileContext}\n\n` : ""}ENTRY:
- Name: ${input.shortName} (${input.jurisdiction})
- Type: ${input.type}, Status: ${input.status}
${input.regulator ? `- Regulator: ${input.regulator}` : ""}

${buildExistingAnalysisBlock(input)}

The primary source documents are provided in the preceding content block. A COMPARATOR REGULATIONS block (analogous instruments from other jurisdictions or related instruments) is also provided when available — use it heavily here. THIS is the section where comparators belong.

YOUR JOB:
Produce a cross-jurisdiction comparative analysis. For each substantively analogous instrument in another jurisdiction (or closely-related instrument in the same one), surface:
- What the analogue is and what it does.
- Where the analogue and this instrument converge (similar scope, similar thresholds, similar penalties).
- Where they diverge in ways that matter for an org operating in both jurisdictions (different scope, different exemptions, different enforcement intensity).
- Any standards-alignment or interoperability points (e.g. a regulator referencing an international standard).

Each claim should be defensible against the comparator block or your knowledge of the analogue regime. Mark grounding accordingly.

DO NOT:
- Treat comparators as authority for THIS instrument's provisions. Cross-references are for context only.
- Restate the entry's own provisions as if they were a comparator point.
- Pad with generic geopolitical observations.

Return ONLY valid JSON in this shape:
{
  "intro": "<0-1 sentence framing of the comparative landscape>",
  "claims": [
    { "text": "<comparative observation>", "citation": { "documentIndex": null, "sectionRef": "<analogue's section ref or null>", "groundingType": "inference|ai_knowledge|paraphrase", "note": "<which analogue, optional>" } }
  ],
  "confidence": { "level": "high|medium|low", "basis": "<brief>" }
}

If there are no genuine analogues to discuss, return { "intro": null, "claims": [], "confidence": null }.`;
}

// --------------------------------------------------------------------------
// Internal helpers.
// --------------------------------------------------------------------------

function buildExistingAnalysisBlock(input: ArtifactInput): string {
  const parts: string[] = [];
  if (input.existingSummary) parts.push(`SUMMARY:\n${input.existingSummary}`);
  if (input.existingApplicability) parts.push(`APPLICABILITY:\n${input.existingApplicability}`);
  if (input.existingKeyCriteria) parts.push(`KEY CRITERIA AND TESTS:\n${input.existingKeyCriteria}`);
  if (input.existingWhyItMatters) parts.push(`BUSINESS IMPACT:\n${input.existingWhyItMatters}`);
  if (input.existingComplianceImplications) {
    parts.push(`REQUIRED ACTIONS (existing prose):\n${input.existingComplianceImplications}`);
  }
  if (input.existingExemptions) parts.push(`EXEMPTIONS:\n${input.existingExemptions}`);
  if (input.existingPenalties) parts.push(`PENALTIES:\n${input.existingPenalties}`);

  if (parts.length === 0) {
    return "EXISTING ANALYSIS: none yet — derive everything from the source documents.\n\n";
  }

  return `EXISTING ANALYSIS ON THIS ENTRY (treat as context — your output should be consistent with this where the existing prose is correct, and supersede it only where you have evidence from the source):\n\n${parts.join("\n\n")}\n\n`;
}

function parseJsonResponse(response: Anthropic.Message): unknown {
  const textBlock = response.content.find((b) => b.type === "text");
  const raw = textBlock?.type === "text" ? textBlock.text : "";
  const cleaned = raw
    .replace(/^```(?:json)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();
  return robustJsonParse(cleaned);
}

function normalizeCrossJurisdictionClaims(
  raw: unknown,
  sourceDocuments: SummarySourceDocument[]
): EntryClaim[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c): EntryClaim | null => {
      if (!c || typeof c !== "object") return null;
      const r = c as Record<string, unknown>;
      const text = typeof r.text === "string" ? r.text.trim() : null;
      if (!text) return null;
      const citation = normalizeArtifactCitation(r.citation, sourceDocuments);
      return { text, citation };
    })
    .filter((c): c is EntryClaim => c !== null);
}

function normalizeArtifactCitation(
  raw: unknown,
  sourceDocuments: SummarySourceDocument[]
): EntryClaimCitation | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const docIndex =
    typeof r.documentIndex === "number" && Number.isFinite(r.documentIndex)
      ? Math.max(1, Math.floor(r.documentIndex))
      : null;
  const doc = docIndex ? sourceDocuments[docIndex - 1] ?? null : null;

  const sectionRef = nullableString(r.sectionRef);
  const note = nullableString(r.note);
  const groundingType = normalizeGroundingType(r.groundingType);

  if (!doc && !sectionRef && !note && !groundingType) return null;

  return {
    sourceDocumentId: doc?.id ?? null,
    sourceDocumentName: doc?.name ?? null,
    sourceUrl: doc?.sourceUrl ?? null,
    sectionRef,
    groundingType,
    note,
  };
}

function normalizeGroundingType(value: unknown): ClaimGrounding | undefined {
  switch (value) {
    case "direct_quote":
    case "paraphrase":
    case "inference":
    case "ai_knowledge":
      return value;
    default:
      return undefined;
  }
}

function normalizeConfidence(raw: unknown): SectionConfidence | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const level = r.level;
  const basis = typeof r.basis === "string" ? r.basis.trim() : "";
  if (level !== "high" && level !== "medium" && level !== "low") return null;
  return { level, basis };
}

function nullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildSectionText(intro: string | null, claims: string[]): string | null {
  const trimmedClaims = claims.map((c) => c.trim()).filter(Boolean);
  const parts: string[] = [];
  if (intro) parts.push(intro.trim());
  if (trimmedClaims.length > 0) {
    parts.push(trimmedClaims.map((c) => `• ${c}`).join("\n"));
  }
  const text = parts.join("\n\n").trim();
  return text || null;
}

