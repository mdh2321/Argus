import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { getProfileContext } from "@/lib/profile-context";
import type {
  ClaimGrounding,
  EntryClaim,
  EntryClaimCitation,
  EntrySectionClaims,
  EntrySectionConfidence,
  EntrySectionKey,
  EscalationTrigger,
  ComplianceChecklistItem,
  ThresholdTest,
} from "./types";

// Phase 5.2 — Calibrated confidence via disagreement (NOT IMPLEMENTED).
//
// The idea: run the draft stage twice with slightly different parameters, then
// compare claims pairwise. Where the two runs agree, mark high confidence.
// Where they diverge, flag the claim as low confidence and surface to the user
// for review. This is an honest "the AI doesn't know its own mind on this"
// signal, distinct from the model's self-reported confidence.
//
// Hook point: insert a second draftLegalAnalysis call right after the first,
// run them via Promise.all, then add a reconcileWithDisagreement step that
// produces a merged draft with disagreement annotations BEFORE the existing
// adversarial critique pass.
//
// Cost: roughly +25% per analysis (one extra draft pass; cache reads cheap).
// Defer until we see real cases where verified claims still slip through.

const client = new Anthropic();
const MODEL = "claude-sonnet-4-6";

// Per-document char cap. Sonnet 4.6 has a 1M context window so we can carry
// most full Acts. Cap per-doc at ~100K tokens (~400K chars) so a single
// pathological document can't blow out the budget. For genuinely huge Acts,
// section-aware retrieval should be added separately.
const MAX_DOC_CHARS = 400000;
const DOC_SLICE_VERIFY = 100000;

export interface SummarySourceDocument {
  id: string;
  name: string;
  sourceUrl: string | null;
  fullText: string;
  sourceAuthority?: string | null;
}

export interface SummaryDefinedTerm {
  term: string;
  definition: string;
  sectionRef: string | null;
  scope: string;
  sourceDocId: string;
}

// Comparator regulation — an analogous tracker entry from another jurisdiction
// (or related instrument from the same one) that the model can cross-reference
// when framing its analysis. Kept lightweight so we don't blow up the prompt.
export interface SummaryComparator {
  shortName: string;
  fullName: string;
  jurisdiction: string;
  category: string;
  status: string;
  regulator: string | null;
  summary: string | null;
  keyCriteria: string | null;
  penalties: string | null;
  // Why this entry was selected as a comparator: typically "same category,
  // different jurisdiction" or "explicitly related" or "parent/subordinate".
  relation: string;
}

// Date-labelled milestone on a tracker entry — commencement, transition end,
// sunset, consultation close, etc. Used to inject timing context into the
// analysis prompt so the model can frame urgency.
export interface SummaryKeyDate {
  date: string; // ISO yyyy-mm-dd
  label: string;
}

interface SummaryInput {
  shortName: string;
  fullName: string;
  jurisdiction: string;
  category: string;
  type: string;
  status: string;
  regulator: string | null;
  existingSummary: string | null;
  existingNotes: string | null;
  sourceDocuments: SummarySourceDocument[];
  // Pre-extracted defined terms from source documents. The model gets the
  // statutory definitions inline rather than re-deriving them from the source
  // every analysis. Optional — empty array is fine when no terms exist yet.
  definedTerms?: SummaryDefinedTerm[];
  // Analogous regulations from other jurisdictions (or related instruments)
  // so the model can frame each provision comparatively.
  comparators?: SummaryComparator[];
  // Today's date and the entry's keyDates so the model can frame urgency
  // (commencement approaching, transition window closing, sunset triggered).
  currentDate?: string; // ISO yyyy-mm-dd
  keyDates?: SummaryKeyDate[];
  relatedEntryNames: string[];
}

export interface GeneratedSummary {
  // Lawyer-style citation, e.g. "Privacy Act 1988 (Cth)". Optional because
  // not every generation will know it (consultation papers, draft bills, etc.
  // may not have a settled citation yet). null when the model couldn't
  // produce one with confidence.
  formalCitation: string | null;
  summary: string;
  applicability: string | null;
  keyCriteria: string | null;
  whyItMatters: string;
  // Dual impact lenses — short plain-text framing, not claim-bearing legal
  // sections. impactOnUs = direct effect on the user's company;
  // impactOnCustomers = pass-through effect on the company's customers
  // (e.g. bank outsourcing rules applying to customers who use the product).
  impactOnUs: string | null;
  impactOnCustomers: string | null;
  complianceImplications: string;
  exemptions: string | null;
  penalties: string | null;
  openQuestions: string | null;
  sectionConfidence: EntrySectionConfidence;
  sectionClaims: EntrySectionClaims;
}

// Per-artifact generators (compliance checklist, threshold tests, escalation
// triggers, cross-jurisdiction analogues) live in `artifact-ai.ts` and are
// triggered on demand by the user — they used to ride along with the summary
// pipeline but bundling them all meant every "Generate Summary" produced
// every output whether the user wanted it or not.

type JsonRecord = Record<string, unknown>;

interface DraftCitation {
  documentIndex?: number | null;
  sectionRef?: string | null;
  groundingType?: string | null;
  note?: string | null;
}

interface DraftClaim {
  text?: string | null;
  citation?: DraftCitation | null;
}

interface DraftSection {
  intro?: string | null;
  claims?: DraftClaim[] | null;
}

// Narrow alias of EntrySectionKey covering only the sections produced by this
// pipeline. relatedContext is omitted — it's now generated separately by
// /generate-artifact (cross-jurisdiction analogues). Keeping a separate
// local type lets DraftResponse drop relatedContext while EntrySectionKey
// stays canonical for the UI.
type SummarySectionKey = Exclude<EntrySectionKey, "relatedContext">;

const SECTION_KEYS: SummarySectionKey[] = [
  "summary",
  "applicability",
  "keyCriteria",
  "whyItMatters",
  "complianceImplications",
  "exemptions",
  "penalties",
  "openQuestions",
];

type DraftResponse = {
  formalCitation?: string | null;
  // Dual impact lenses ride along as plain short strings — they are business
  // framing (inference by construction), so they skip the claims machinery.
  impactOnUs?: string | null;
  impactOnCustomers?: string | null;
  summary?: DraftSection | null;
  applicability?: DraftSection | null;
  keyCriteria?: DraftSection | null;
  whyItMatters?: DraftSection | null;
  complianceImplications?: DraftSection | null;
  exemptions?: DraftSection | null;
  penalties?: DraftSection | null;
  openQuestions?: DraftSection | null;
  sectionConfidence?: EntrySectionConfidence | null;
};

interface CritiqueIssue {
  section: string;
  severity: "high" | "medium" | "low";
  problem: string;
  suggestedFix: string;
}

interface CritiqueResponse {
  overallAssessment: string;
  missedIssues: CritiqueIssue[];
  weakClaims: CritiqueIssue[];
  counterReadings: CritiqueIssue[];
  jurisdictionalConcerns: CritiqueIssue[];
}

type VerificationStatus = "verified" | "partial" | "unsupported" | "not_found";

interface VerificationResult {
  claimKey: string;
  status: VerificationStatus;
  evidence: string | null;
  reasoning: string | null;
}

// --------------------------------------------------------------------------
// Cached-sources helpers. Source documents are large and identical across the
// draft / critique / reconcile passes, so we put them in their own user content
// block with cache_control. After the first request writes the cache, the
// remaining passes pay ~0.1x for the source-document tokens.
// --------------------------------------------------------------------------
export function buildSourcesBlock(
  docs: SummarySourceDocument[],
  terms?: SummaryDefinedTerm[],
  comparators?: SummaryComparator[]
): string {
  const hasTerms = terms && terms.length > 0;
  const hasComparators = comparators && comparators.length > 0;
  if (docs.length === 0 && !hasTerms && !hasComparators) return "";

  // Defined-term registry comes BEFORE the source-doc text so the model has
  // the statutory definitions in mind while reading the operative provisions.
  // Order is deterministic so the cache key is stable.
  const termsBlock = hasTerms
    ? `DEFINED TERMS REGISTRY (extracted from the source documents — treat as the canonical statutory meaning):\n${terms!
        .slice()
        .sort((a, b) => a.term.localeCompare(b.term))
        .map((t) => {
          const ref = t.sectionRef ? ` (${t.sectionRef})` : "";
          const scope = t.scope !== "act-wide" ? ` [scope: ${t.scope}]` : "";
          return `- "${t.term}"${ref}${scope}: ${t.definition}`;
        })
        .join("\n")}\n`
    : "";

  const docsBlock =
    docs.length > 0
      ? `PRIMARY SOURCE DOCUMENTS:\n${docs
          .map((doc, i) =>
            [
              `--- Document ${i + 1} ---`,
              `Name: ${doc.name}`,
              doc.sourceUrl ? `URL: ${doc.sourceUrl}` : null,
              doc.sourceAuthority ? `Authority: ${doc.sourceAuthority}` : null,
              `Text:\n${doc.fullText.slice(0, MAX_DOC_CHARS)}`,
            ]
              .filter(Boolean)
              .join("\n")
          )
          .join("\n\n")}`
      : "";

  // Comparators come last in the cached prefix. They turn over slightly more
  // than source docs (a new tracker entry in the same category invalidates
  // them) but are still stable enough to cache. Cap each comparator's body so
  // a long related entry doesn't crowd out the primary text.
  const comparatorBlock = hasComparators
    ? `COMPARATOR REGULATIONS (analogous instruments from other jurisdictions or related instruments — for cross-jurisdictional framing only, NOT primary authority for this analysis):\n${comparators!
        .slice()
        .sort((a, b) => a.shortName.localeCompare(b.shortName))
        .map((c) => {
          const lines = [
            `- ${c.shortName} (${c.jurisdiction}) — ${c.relation}`,
            `  Full name: ${c.fullName}`,
            `  Status: ${c.status}${c.regulator ? `, Regulator: ${c.regulator}` : ""}`,
          ];
          if (c.summary) lines.push(`  Summary: ${c.summary.slice(0, 600)}`);
          if (c.keyCriteria) lines.push(`  Key criteria: ${c.keyCriteria.slice(0, 600)}`);
          if (c.penalties) lines.push(`  Penalties: ${c.penalties.slice(0, 400)}`);
          return lines.join("\n");
        })
        .join("\n\n")}\n`
    : "";

  return [termsBlock, docsBlock, comparatorBlock].filter(Boolean).join("\n\n");
}

// Build a timing-context block for the model: today's date and any tracked
// key dates with how far in the future / past they are. Lives in the variable
// (non-cached) instructions block because today's date changes per analysis.
export function buildTimingBlock(currentDate?: string, keyDates?: SummaryKeyDate[]): string {
  if (!currentDate) return "";
  const today = parseIsoDate(currentDate);
  if (!today) return "";

  const dateLines: string[] = [`\nTODAY'S DATE: ${currentDate}`];

  if (keyDates && keyDates.length > 0) {
    const annotated = keyDates
      .map((kd) => {
        const d = parseIsoDate(kd.date);
        if (!d) return null;
        const days = Math.round((d.getTime() - today.getTime()) / 86400000);
        let when: string;
        if (days === 0) when = "today";
        else if (days > 0 && days <= 30) when = `in ${days} day${days === 1 ? "" : "s"} — IMMINENT`;
        else if (days > 30 && days <= 90) when = `in ${days} days — approaching`;
        else if (days > 90) when = `in ${days} days`;
        else if (days < 0 && days >= -30) when = `${-days} day${days === -1 ? "" : "s"} ago`;
        else when = `${-days} days ago`;
        return `  - ${kd.date} (${when}): ${kd.label}`;
      })
      .filter((line): line is string => line !== null);

    if (annotated.length > 0) {
      dateLines.push("KEY DATES FOR THIS ENTRY:");
      dateLines.push(...annotated);
      dateLines.push(
        "Use these dates to frame urgency. If a commencement, transition deadline, or sunset is within 90 days, surface it in whyItMatters and complianceImplications. If a date has passed, treat the corresponding obligation as live."
      );
    }
  }

  return dateLines.join("\n");
}

function parseIsoDate(iso: string): Date | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return isNaN(d.getTime()) ? null : d;
}

export async function callCached(opts: {
  sources: string;
  instructions: string;
  maxTokens: number;
  thinking?: boolean;
}): Promise<Anthropic.Message> {
  const content = opts.sources
    ? [
        {
          type: "text" as const,
          text: opts.sources,
          cache_control: { type: "ephemeral" as const },
        },
        { type: "text" as const, text: opts.instructions },
      ]
    : opts.instructions;

  // Streaming, not create. With max_tokens > ~21K the SDK refuses
  // non-streaming calls because the projected wall-clock would exceed its
  // 10-minute timeout. We collect the stream into a final Message so the
  // existing parser code is unchanged.
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: opts.maxTokens,
    // Bounded thinking budget — adaptive lets the model run for many minutes
    // on a 200KB-context request, which stacked across 4 stages routinely
    // exceeded the HTTP request lifetime. 4096 tokens is enough for the kind
    // of legal reasoning we want without open-ended runs.
    ...(opts.thinking ? { thinking: { type: "enabled" as const, budget_tokens: 4096 } } : {}),
    messages: [{ role: "user", content }],
  });
  return stream.finalMessage();
}

// --------------------------------------------------------------------------
// Preliminary summary — single-shot, AI-knowledge only. Used when an entry
// has no source documents attached so the user can still get an oriented
// "gist" while they hunt down primary text. Skips the critique / reconcile /
// verify stages entirely (they have nothing to verify against). Confidence
// across all sections defaults to low; every claim is marked
// groundingType: "ai_knowledge". The UI flags the resulting entry as
// preliminary so the reader knows this isn't grounded analysis.
// --------------------------------------------------------------------------
export async function generatePreliminarySummary(
  input: SummaryInput
): Promise<GeneratedSummary> {
  const profileContext = await getProfileContext();
  const instructions = buildPreliminaryInstructions(input, profileContext);

  // No sources block — the whole point is to run without primary text.
  // Single call to Sonnet without thinking; the gist doesn't need extended
  // reasoning and the user is waiting on this to come back fast.
  const response = await callCached({
    sources: "",
    instructions,
    maxTokens: 12000,
    thinking: false,
  });

  const draft = parseDraftJson(response);
  return normalizeToGeneratedSummary(draft, input.sourceDocuments);
}

function buildPreliminaryInstructions(input: SummaryInput, profileContext: string): string {
  const timingBlock = buildTimingBlock(input.currentDate, input.keyDates);
  return `You are a senior legal intelligence analyst producing a PRELIMINARY orientation note for an in-house team.

${profileContext ? `USER CONTEXT:\n${profileContext}\n\n` : ""}This is a fast, AI-knowledge-only sketch — no primary source documents are attached. Your job is to give the reader a useful first orientation: what the instrument is, who it covers, what it does, what to watch for. The reader knows this is preliminary and will request a full grounded analysis once source documents are attached.

ENTRY DETAILS:
- Name: ${input.shortName}
- Full name: ${input.fullName}
- Jurisdiction: ${input.jurisdiction}
- Category: ${input.category}
- Type: ${input.type}
- Status: ${input.status}
${input.regulator ? `- Regulator: ${input.regulator}` : ""}
${input.existingSummary ? `\nEXISTING SUMMARY (use only as draft context):\n${input.existingSummary}` : ""}
${input.existingNotes ? `\nEXISTING MANUAL NOTES (editorial context only):\n${input.existingNotes}` : ""}${timingBlock}

CRITICAL CONSTRAINTS — this is preliminary, not full analysis:
- Every claim MUST use citation.groundingType = "ai_knowledge". Do not invent section references — set citation.sectionRef to null.
- Default sectionConfidence to "low" for every section. Promote to "medium" ONLY for very widely-known instruments where you're confident the broad strokes are right (e.g. GDPR, HIPAA, well-established Acts). Never use "high".
- Be brief. Keep each section to 1–4 short claims. The reader will ask for a deeper dive once sources are attached; don't pretend to be exhaustive.
- If you genuinely don't know enough about this instrument from training, set the relevant section to null with a single claim noting the gap. Better to flag uncertainty than to make things up.
- Skip the IRAC discipline that the full pipeline uses — there are no rules to cite. Every claim should be a plain-language assertion the reader can sanity-check against primary text once they have it.

Return ONLY valid JSON:
{
  "formalCitation": "<lawyer-style citation if you're confident (e.g. 'Privacy Act 1988 (Cth)', 'Pub. L. 116-283'). Set to null if uncertain — better empty than wrong.>",
  "summary": {
    "intro": "<1 sentence on what the instrument is and what it does>",
    "claims": [
      { "text": "<key provision, scope, or status point>", "citation": { "documentIndex": null, "sectionRef": null, "groundingType": "ai_knowledge", "note": "<optional brief gloss>" } }
    ]
  },
  "applicability": { "intro": null, "claims": [{ "text": "<who is in scope, broad strokes>", "citation": { "documentIndex": null, "sectionRef": null, "groundingType": "ai_knowledge" } }] },
  "keyCriteria": { "intro": null, "claims": [{ "text": "<the operative test, threshold, or trigger as you understand it>", "citation": { "documentIndex": null, "sectionRef": null, "groundingType": "ai_knowledge" } }] },
  "whyItMatters": { "intro": null, "claims": [{ "text": "<plausible business impact for a SaaS company>", "citation": { "documentIndex": null, "sectionRef": null, "groundingType": "ai_knowledge" } }] },
  "impactOnUs": "<1-2 plain sentences: likely direct effect on the user's company described in USER CONTEXT, or null if unsure>",
  "impactOnCustomers": "<1-2 plain sentences: likely effect on the company's customers incl. pass-through vendor requirements, or null if unsure>",
  "complianceImplications": { "intro": null, "claims": [{ "text": "<broad action the org probably needs to take>", "citation": { "documentIndex": null, "sectionRef": null, "groundingType": "ai_knowledge" } }] },
  "exemptions": { "intro": null, "claims": [{ "text": "<known carve-outs, or null section if unsure>", "citation": { "documentIndex": null, "sectionRef": null, "groundingType": "ai_knowledge" } }] },
  "penalties": { "intro": null, "claims": [{ "text": "<broad penalty range or enforcement posture>", "citation": { "documentIndex": null, "sectionRef": null, "groundingType": "ai_knowledge" } }] },
  "openQuestions": { "intro": null, "claims": [{ "text": "<what the user should verify against primary sources first>", "citation": { "documentIndex": null, "sectionRef": null, "groundingType": "ai_knowledge", "note": "<why uncertain>" } }] },
  "sectionConfidence": {
    "summary": { "level": "low", "basis": "Preliminary AI-knowledge analysis; no source documents attached." },
    "applicability": { "level": "low", "basis": "Preliminary AI-knowledge analysis; no source documents attached." },
    "keyCriteria": { "level": "low", "basis": "Preliminary AI-knowledge analysis; no source documents attached." },
    "whyItMatters": { "level": "low", "basis": "Preliminary AI-knowledge analysis; no source documents attached." },
    "complianceImplications": { "level": "low", "basis": "Preliminary AI-knowledge analysis; no source documents attached." },
    "exemptions": { "level": "low", "basis": "Preliminary AI-knowledge analysis; no source documents attached." },
    "penalties": { "level": "low", "basis": "Preliminary AI-knowledge analysis; no source documents attached." },
    "openQuestions": { "level": "low", "basis": "Preliminary AI-knowledge analysis; no source documents attached." }
  }
}

A section can be set to null at the top level if you don't have enough knowledge to say anything useful — e.g. { "exemptions": null }. Don't fabricate.`;
}

// --------------------------------------------------------------------------
// Public entry point — orchestrates the 4-stage analysis pipeline.
// --------------------------------------------------------------------------
export async function generateEntrySummary(
  input: SummaryInput
): Promise<GeneratedSummary> {
  const profileContext = await getProfileContext();

  // Stage 1: Initial deep analysis with adaptive thinking.
  const draft = await draftLegalAnalysis(input, profileContext);

  // Stage 2: Adversarial critique pass.
  const critique = await runAdversarialCritique(input, profileContext, draft);

  // Stage 3: Reconciliation pass that addresses the critique.
  const revised = await reconcileWithCritique(
    input,
    profileContext,
    draft,
    critique
  );

  // Stage 4: Citation verification — quote each cited section back from the
  // source document and downgrade unsupported claims.
  const verified = await verifyCitations(input, revised);

  return normalizeToGeneratedSummary(verified, input.sourceDocuments);
}

// --------------------------------------------------------------------------
// Stage 1: Draft legal analysis with adaptive thinking.
// --------------------------------------------------------------------------
async function draftLegalAnalysis(
  input: SummaryInput,
  profileContext: string
): Promise<DraftResponse> {
  const sources = buildSourcesBlock(input.sourceDocuments, input.definedTerms, input.comparators);
  const instructions = buildDraftInstructions(input, profileContext);

  const response = await callCached({
    sources,
    instructions,
    maxTokens: 32000,
    thinking: true,
  });

  return parseDraftJson(response);
}

function buildDraftInstructions(input: SummaryInput, profileContext: string): string {
  const hasSourceDocs = input.sourceDocuments.length > 0;

  const relatedContext =
    input.relatedEntryNames.length > 0
      ? `\nOTHER ENTRIES IN ARGUS (for cross-referencing only):\n${input.relatedEntryNames.map((n) => `- ${n}`).join("\n")}`
      : "";

  const timingBlock = buildTimingBlock(input.currentDate, input.keyDates);

  return `You are a senior legal intelligence analyst specialising in Asia-Pacific regulatory frameworks. You maintain a knowledge base for a SaaS company's legal and compliance team tracking regulation across AU, NZ, SG, JP, HK, IN, and PH.

${profileContext ? `USER CONTEXT:\n${profileContext}\n\n` : ""}Generate a concise, source-aware reference page for this legislation/regulation. The reader is an in-house lawyer who needs fast, auditable answers.

ENTRY DETAILS:
- Name: ${input.shortName}
- Full name: ${input.fullName}
- Jurisdiction: ${input.jurisdiction}
- Category: ${input.category}
- Type: ${input.type}
- Status: ${input.status}
${input.regulator ? `- Regulator: ${input.regulator}` : ""}
${input.existingSummary ? `\nEXISTING SUMMARY (use only as draft context, not as authority):\n${input.existingSummary}` : ""}
${input.existingNotes ? `\nEXISTING MANUAL NOTES (editorial context only):\n${input.existingNotes}` : ""}${relatedContext}${timingBlock}
${hasSourceDocs ? "\nThe primary source documents are provided in the preceding content block. Treat them as ground truth. If a defined-terms registry is provided in that block, use those statutory definitions exactly when interpreting the source — do not paraphrase the definition or substitute a colloquial meaning. If a comparator regulations block is provided, use it ONLY for cross-jurisdictional framing in the relatedContext section and where genuinely informative elsewhere — never cite a comparator as authority for THIS instrument's provisions.\n" : "\nNo primary source documents are attached. Be conservative — mark all claims you cannot tie to provided source text as groundingType: 'ai_knowledge'.\n"}
LEGAL REASONING APPROACH (IRAC):
- Read the primary source documents carefully before drafting any section.
- For the legal-rule sections — applicability, keyCriteria, exemptions, complianceImplications, penalties — every claim MUST follow IRAC structure across the existing fields:
    • Issue: implicit in the section heading (e.g. who is in scope, what triggers the obligation, what carve-outs exist).
    • Rule: the pinpoint citation goes in citation.sectionRef (e.g. "s 26(1)", "Art 4(2)(b)", "Sched 2 para 3"). Distinguish primary Act from subordinate regulations and regulator guidance.
    • Application: the citation.note field MUST contain a one-sentence application showing how this rule lands for the user described in USER CONTEXT (sectors, jurisdictions, products, role). If the rule applies generally with no user-specific carve-out, write "Applies generally; no user-specific carve-out." Do not leave note empty for these sections.
    • Conclusion: the claim.text states the conclusion in plain language ("Operators of designated services must register within 30 days...").
- For summary, whyItMatters, openQuestions, relatedContext — IRAC is not strictly required, but use citation.note to explain the inferential step where applicable.
- Prefer pinpoint citations over generic references.
- Distinguish settled law from contested or untested interpretation. Mark contested points as such.
- If the source documents do not contain the answer, say so. Do NOT fill gaps with general knowledge of analogous regulations unless explicitly marked groundingType: "ai_knowledge".

CRITICAL INSTRUCTIONS:
${hasSourceDocs
    ? "Use the primary source documents above as ground truth. Each bullet claim should cite the most relevant document number and section/article/clause where possible."
    : "No primary source document text is attached. Be conservative. Use 'ai_knowledge' grounding when you cannot tie a claim to a source document. Do not invent section references."}
- Organise the output into explicit legal triage sections. Do not bury scope, triggers, carve-outs, or operative tests inside generic prose.
- Each section should be scannable in under 10 seconds.
- Use null for sections that are genuinely not applicable or not yet assessable from the source material.
- Keep business impact separate from legal obligations.
- DUAL IMPACT LENSES: "impactOnUs" and "impactOnCustomers" are short plain-text strings (not claim objects). Impact means effects flowing to the user's company directly, OR effects reaching it through its customers (pass-through: a rule that binds the customer becomes a vendor requirement) — not general news significance. Each lens must be specific enough to paste into a Slack message unedited.

FORMATTING RULES:
- Return ONLY valid JSON.
- Each section object must use this shape: { "intro": string | null, "claims": [{ "text": string, "citation": { ... } | null }] }.
- Keep intros to 0-1 short sentence. Put the substance into claims.
- Each claim should be one factual point.
- Citation objects may use:
  - "documentIndex": 1-based integer matching the numbered source documents above
  - "sectionRef": e.g. "Section 26(1)", "Article 4", "Part III"
  - "groundingType": one of "direct_quote", "paraphrase", "inference", "ai_knowledge"
  - "note": short explanation such as "Derived from definition section"
- If a claim is business impact or inference rather than a direct legal requirement, mark groundingType accordingly.

Return ONLY valid JSON:
{
  "formalCitation": "<lawyer-style citation, e.g. 'Privacy Act 1988 (Cth)', 'Pub. L. 116-283', 'Regulation (EU) 2016/679'. Use the citation form actually used by practitioners in the relevant jurisdiction. Set to null if you can't produce one with confidence (e.g. unsigned bills, draft consultation papers).>",
  "summary": {
    "intro": "<1 sentence on what the instrument is and what it does>",
    "claims": [
      { "text": "<key provision or status point>", "citation": { "documentIndex": 1, "sectionRef": "<ref>", "groundingType": "paraphrase", "note": "<optional>" } }
    ]
  },
  "applicability": {
    "intro": null,
    "claims": [
      { "text": "<conclusion: who is in scope, territorial scope, affected actors or activities>", "citation": { "documentIndex": 1, "sectionRef": "<rule pinpoint>", "groundingType": "paraphrase", "note": "<application: how this scope captures or excludes the user's products/jurisdictions>" } }
    ]
  },
  "keyCriteria": {
    "intro": null,
    "claims": [
      { "text": "<conclusion: legal test, trigger, operative threshold, or named criterion>", "citation": { "documentIndex": 1, "sectionRef": "<rule pinpoint>", "groundingType": "paraphrase", "note": "<application: which of the user's services / data flows would meet or fail this test>" } }
    ]
  },
  "whyItMatters": {
    "intro": null,
    "claims": [
      { "text": "<practical business impact for the user's company>", "citation": { "documentIndex": 1, "sectionRef": "<ref or null>", "groundingType": "inference", "note": "<why this follows from the rule and the user's profile>" } }
    ]
  },
  "impactOnUs": "<1-3 plain sentences: how this instrument affects the user's company DIRECTLY — its own obligations, product features, contracts, or market position. Write it as the pre-prepared answer to 'what does this mean for us?'. Null only if there is genuinely no direct effect.>",
  "impactOnCustomers": "<1-3 plain sentences: how this instrument affects the company's CUSTOMERS, including pass-through effects — rules that bind customers (e.g. financial-sector outsourcing or data rules) and therefore flow down to the company as their vendor. Write it as the pre-prepared answer to 'what does this mean for our customers?'. Null only if there is genuinely no customer-side effect.>",
  "complianceImplications": {
    "intro": null,
    "claims": [
      { "text": "<conclusion: specific required action, control, disclosure, process, or record-keeping step>", "citation": { "documentIndex": 1, "sectionRef": "<rule pinpoint>", "groundingType": "paraphrase", "note": "<application: who in the user's org owns this and what evidence demonstrates compliance>" } }
    ]
  },
  "exemptions": {
    "intro": null,
    "claims": [
      { "text": "<conclusion: exemption, carve-out, safe harbour, or qualification>", "citation": { "documentIndex": 1, "sectionRef": "<rule pinpoint>", "groundingType": "paraphrase", "note": "<application: whether and how the user's situation could fit the carve-out>" } }
    ]
  },
  "penalties": {
    "intro": null,
    "claims": [
      { "text": "<conclusion: penalty, enforcement power, or remedy>", "citation": { "documentIndex": 1, "sectionRef": "<rule pinpoint>", "groundingType": "paraphrase", "note": "<application: max exposure for an entity of the user's size, plus any indirect/civil consequences>" } }
    ]
  },
  "openQuestions": {
    "intro": null,
    "claims": [
      { "text": "<ambiguity, unresolved interpretive issue, pending rule, or uncertainty>", "citation": { "documentIndex": 1, "sectionRef": "<ref or null>", "groundingType": "inference", "note": "<why unresolved>" } }
    ]
  },
  "sectionConfidence": {
    "summary": { "level": "high|medium|low", "basis": "<brief>" },
    "applicability": { "level": "high|medium|low", "basis": "<brief>" },
    "keyCriteria": { "level": "high|medium|low", "basis": "<brief>" },
    "whyItMatters": { "level": "high|medium|low", "basis": "<brief>" },
    "complianceImplications": { "level": "high|medium|low", "basis": "<brief>" },
    "exemptions": { "level": "high|medium|low", "basis": "<brief>" },
    "penalties": { "level": "high|medium|low", "basis": "<brief>" },
    "openQuestions": { "level": "high|medium|low", "basis": "<brief>" }
  }
}

Cross-jurisdiction analogues, compliance checklists, threshold tests, and escalation triggers are NOT produced here — they are separate on-demand artifacts the user generates via dedicated tools. Do not include those sections in your output.`;
}

// --------------------------------------------------------------------------
// Stage 2: Adversarial critique. Given the draft, find weaknesses, missed
// carve-outs, and counter-readings. Output is structured JSON, not prose.
// --------------------------------------------------------------------------
async function runAdversarialCritique(
  input: SummaryInput,
  profileContext: string,
  draft: DraftResponse
): Promise<CritiqueResponse> {
  const sources = buildSourcesBlock(input.sourceDocuments, input.definedTerms, input.comparators);
  const instructions = buildCritiqueInstructions(input, profileContext, draft);

  const response = await callCached({
    sources,
    instructions,
    maxTokens: 12000,
    thinking: true,
  });

  return parseCritiqueJson(response);
}

function buildCritiqueInstructions(
  input: SummaryInput,
  profileContext: string,
  draft: DraftResponse
): string {
  return `You are a senior regulatory enforcement lawyer reviewing a colleague's draft analysis. Your job is to play devil's advocate and find every weakness in the draft before it goes to the client.

${profileContext ? `USER CONTEXT (this is who the analysis is for):\n${profileContext}\n\n` : ""}ENTRY UNDER REVIEW:
- Name: ${input.shortName} (${input.jurisdiction})
- Type: ${input.type}, Status: ${input.status}
${input.regulator ? `- Regulator: ${input.regulator}` : ""}

DRAFT ANALYSIS TO CRITIQUE:
${JSON.stringify(draft, null, 2)}

The primary source documents are provided in the preceding content block. Use them — and only them, plus your knowledge of legal reasoning — to find what the draft got wrong.

YOUR JOB:
You are NOT being asked to summarise the law. You are being asked to find what the draft GOT WRONG or MISSED. Be ruthless and specific. Surface:

1. **Missed issues** — exemptions, carve-outs, transitional provisions, sub-thresholds, or schedule items the draft didn't mention. Check definitions sections carefully — many obligations turn on defined terms.
2. **Weak claims** — claims that are vague, conflate distinct legal concepts, mix primary law with subordinate regulations, or could not actually be supported by the cited section.
3. **Counter-readings** — places where a regulator or defendant could plausibly read the same provision differently. Flag ambiguity that the draft has glossed over.
4. **Jurisdictional concerns** — territorial scope issues, extraterritorial reach, conflicts with other instruments in the same jurisdiction or analogue regimes elsewhere, transition / commencement timing.

DO NOT:
- Repeat what the draft already says.
- Praise the draft. Only flag problems.
- Make up new legal facts. Only use the source documents above.
- Suggest stylistic changes.

If the draft is genuinely strong on a dimension, return an empty array for that category — don't pad with low-value observations.

Return ONLY valid JSON in this shape:
{
  "overallAssessment": "<2-3 sentence summary of the draft's biggest weaknesses>",
  "missedIssues": [
    {
      "section": "<which section of the draft, e.g. 'exemptions' or 'applicability'>",
      "severity": "high|medium|low",
      "problem": "<what is missing>",
      "suggestedFix": "<concrete claim that should be added, with sectionRef where possible>"
    }
  ],
  "weakClaims": [
    {
      "section": "<section name>",
      "severity": "high|medium|low",
      "problem": "<what's wrong with the existing claim>",
      "suggestedFix": "<how to tighten or correct it>"
    }
  ],
  "counterReadings": [
    {
      "section": "<section name>",
      "severity": "high|medium|low",
      "problem": "<the alternative reading the draft missed>",
      "suggestedFix": "<how to acknowledge the ambiguity>"
    }
  ],
  "jurisdictionalConcerns": [
    {
      "section": "<section name>",
      "severity": "high|medium|low",
      "problem": "<scope / conflict / timing issue>",
      "suggestedFix": "<concrete addition>"
    }
  ]
}`;
}

// --------------------------------------------------------------------------
// Stage 3: Reconciliation. Take the draft + critique and produce a revised
// version of the same JSON schema, addressing the critique's findings.
// --------------------------------------------------------------------------
async function reconcileWithCritique(
  input: SummaryInput,
  profileContext: string,
  draft: DraftResponse,
  critique: CritiqueResponse
): Promise<DraftResponse> {
  // If the critique is empty, skip the reconcile pass and return the draft.
  const totalIssues =
    critique.missedIssues.length +
    critique.weakClaims.length +
    critique.counterReadings.length +
    critique.jurisdictionalConcerns.length;
  if (totalIssues === 0) {
    return draft;
  }

  const sources = buildSourcesBlock(input.sourceDocuments, input.definedTerms, input.comparators);
  const instructions = buildReconciliationInstructions(input, profileContext, draft, critique);

  const response = await callCached({
    sources,
    instructions,
    maxTokens: 32000,
    thinking: true,
  });

  return parseDraftJson(response);
}

function buildReconciliationInstructions(
  input: SummaryInput,
  profileContext: string,
  draft: DraftResponse,
  critique: CritiqueResponse
): string {
  return `You are the senior legal intelligence analyst who wrote the draft below. A reviewing enforcement lawyer has critiqued it. Your job is to produce a revised version that addresses every legitimate critique while preserving everything that was already correct.

${profileContext ? `USER CONTEXT:\n${profileContext}\n\n` : ""}ENTRY:
- Name: ${input.shortName} (${input.jurisdiction})
- Type: ${input.type}, Status: ${input.status}
${input.regulator ? `- Regulator: ${input.regulator}` : ""}

YOUR ORIGINAL DRAFT:
${JSON.stringify(draft, null, 2)}

REVIEWER CRITIQUE:
${JSON.stringify(critique, null, 2)}

The primary source documents are provided in the preceding content block. Re-read the cited sections before revising — every revision should be defensible against the source.

HOW TO REVISE:
- Address every "high" severity issue. Address "medium" if you agree with it after re-reading the source. Use judgement on "low".
- If you disagree with a critique item (e.g. the reviewer is wrong about what the source says), keep the original claim and add a brief note in the relevant claim's "note" field explaining why.
- For missed issues, add new claims with concrete sectionRefs where the source supports it.
- For weak claims, tighten the wording or split into multiple narrower claims.
- For counter-readings, add a claim acknowledging the ambiguity (groundingType: "inference") rather than picking one side without evidence.
- For jurisdictional concerns, add the missing scope/timing/conflict claims.
- Update "sectionConfidence" if the critique meaningfully changed your confidence in any section.
- DO NOT delete claims unless the critique shows they are wrong.
- DO NOT invent section references. If you don't have a clean cite, mark groundingType as "inference" or "ai_knowledge".

PRESERVE IRAC STRUCTURE:
- Every claim in applicability, keyCriteria, exemptions, complianceImplications, and penalties must keep IRAC discipline:
    • claim.text = plain-language conclusion
    • citation.sectionRef = pinpoint rule citation
    • citation.note = one-sentence application showing how the rule lands for the user described in USER CONTEXT (sectors, jurisdictions, products, role)
- If you add a new claim in any of those sections, fill all three. Do not leave citation.note empty for a legal-rule claim.

Return the FULL revised analysis in EXACTLY the same JSON shape as the draft. The shape is:
{
  "formalCitation":         "<lawyer-style citation or null>",
  "summary":                { "intro": ..., "claims": [...] },
  "applicability":          { "intro": ..., "claims": [...] },
  "keyCriteria":            { "intro": ..., "claims": [...] },
  "whyItMatters":           { "intro": ..., "claims": [...] },
  "impactOnUs":             "<short plain string — revise only if the critique touched it, else carry through unchanged>",
  "impactOnCustomers":      "<short plain string — revise only if the critique touched it, else carry through unchanged>",
  "complianceImplications": { "intro": ..., "claims": [...] },
  "exemptions":             { "intro": ..., "claims": [...] },
  "penalties":              { "intro": ..., "claims": [...] },
  "openQuestions":          { "intro": ..., "claims": [...] },
  "sectionConfidence":      { "summary": {"level":..., "basis":...}, ...one entry per section }
}
Do not return only the changes; return the full revised document with ALL top-level keys present. Do not invent the dropped sections (relatedContext, escalationTriggers, complianceChecklist, thresholdTests) — they are produced separately on demand.

Return ONLY valid JSON.`;
}

// --------------------------------------------------------------------------
// Stage 4: Citation verification. For every claim that cites a sectionRef of
// a source document, ask the model to quote the exact text from that section
// and confirm the claim is supported. Downgrade or annotate unverified claims.
// --------------------------------------------------------------------------
async function verifyCitations(
  input: SummaryInput,
  draft: DraftResponse
): Promise<DraftResponse> {
  if (input.sourceDocuments.length === 0) return draft;

  // Collect all (section, claimIndex, claim) tuples whose citation has both a
  // documentIndex and a sectionRef. These are the only claims worth verifying.
  type CitedClaimRef = {
    sectionKey: SummarySectionKey;
    claimIndex: number;
    docIndex: number;
    sectionRef: string;
    text: string;
  };

  const cited: CitedClaimRef[] = [];
  for (const sectionKey of SECTION_KEYS) {
    const section = draft[sectionKey];
    if (!section?.claims) continue;
    section.claims.forEach((claim, claimIndex) => {
      const citation = claim?.citation;
      if (!citation) return;
      const docIndex = typeof citation.documentIndex === "number"
        ? citation.documentIndex
        : null;
      const sectionRef = nullableString(citation.sectionRef);
      const text = nullableString(claim.text);
      if (!docIndex || !sectionRef || !text) return;
      const grounding = normalizeGroundingType(citation.groundingType);
      // Don't waste tokens verifying inferences or ai_knowledge claims.
      if (grounding === "inference" || grounding === "ai_knowledge") return;
      cited.push({ sectionKey, claimIndex, docIndex, sectionRef, text });
    });
  }

  if (cited.length === 0) return draft;

  // Group claims by document for efficient verification (one API call per doc).
  const byDoc = new Map<number, CitedClaimRef[]>();
  for (const ref of cited) {
    const list = byDoc.get(ref.docIndex) ?? [];
    list.push(ref);
    byDoc.set(ref.docIndex, list);
  }

  const verifications = new Map<string, VerificationResult>();
  await Promise.all(
    Array.from(byDoc.entries()).map(async ([docIndex, refs]) => {
      const doc = input.sourceDocuments[docIndex - 1];
      if (!doc) return;
      const results = await verifyClaimsAgainstDocument(doc, refs);
      for (const result of results) {
        verifications.set(result.claimKey, result);
      }
    })
  );

  // Apply verification results: downgrade unsupported claims, annotate notes
  // with the supporting evidence quote where verified.
  return applyVerificationResults(draft, verifications);
}

async function verifyClaimsAgainstDocument(
  doc: SummarySourceDocument,
  refs: Array<{
    sectionKey: SummarySectionKey;
    claimIndex: number;
    sectionRef: string;
    text: string;
  }>
): Promise<VerificationResult[]> {
  const claimList = refs
    .map(
      (ref, i) =>
        `[${i + 1}] sectionRef: "${ref.sectionRef}" — claim: "${ref.text}"`
    )
    .join("\n");

  const prompt = `You are verifying citations in a legal analysis. For each claim below, locate the cited section in the source document and confirm whether the claim is actually supported.

SOURCE DOCUMENT: ${doc.name}${doc.sourceAuthority ? ` (authority: ${doc.sourceAuthority})` : ""}

DOCUMENT TEXT:
${doc.fullText.slice(0, DOC_SLICE_VERIFY)}

CLAIMS TO VERIFY:
${claimList}

For each claim:
1. Find the cited section in the document text.
2. Quote the most relevant sentence (or sentences, max 200 chars total) verbatim from the source.
3. Decide:
   - "verified" — the source clearly supports the claim
   - "partial" — the source partially supports the claim or the claim overstates the source
   - "unsupported" — the source does not support the claim
   - "not_found" — the cited section could not be located in the document text provided

If the document text appears to be truncated and the cited section is past the end, return "not_found" rather than guessing.

Return ONLY valid JSON, one object per claim, in this exact shape:
{
  "results": [
    {
      "claimNumber": 1,
      "status": "verified",
      "evidence": "<verbatim quote from source, or null if not_found>",
      "reasoning": "<one short sentence on why>"
    }
  ]
}`;

  let parsed: { results?: Array<{ claimNumber?: number; status?: string; evidence?: string | null; reasoning?: string | null }> } = {};
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      messages: [{ role: "user", content: prompt }],
    });
    const text =
      response.content[0]?.type === "text" ? response.content[0].text : "";
    const cleaned = text.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
    parsed = robustJsonParse(cleaned) as typeof parsed;
  } catch {
    // If verification fails for a doc, return not_found for all its claims so
    // we surface the lack of verification rather than silently passing them.
    return refs.map((ref) => ({
      claimKey: claimKey(ref.sectionKey, ref.claimIndex),
      status: "not_found" as VerificationStatus,
      evidence: null,
      reasoning: "Verification call failed.",
    }));
  }

  const results = Array.isArray(parsed.results) ? parsed.results : [];
  return refs.map((ref, i) => {
    const r = results.find((x) => x.claimNumber === i + 1) ?? results[i];
    const status = normalizeVerificationStatus(r?.status);
    return {
      claimKey: claimKey(ref.sectionKey, ref.claimIndex),
      status,
      evidence: nullableString(r?.evidence),
      reasoning: nullableString(r?.reasoning),
    };
  });
}

function normalizeVerificationStatus(value: unknown): VerificationStatus {
  switch (value) {
    case "verified":
    case "partial":
    case "unsupported":
    case "not_found":
      return value;
    default:
      return "not_found";
  }
}

function claimKey(sectionKey: SummarySectionKey, claimIndex: number): string {
  return `${sectionKey}#${claimIndex}`;
}

function applyVerificationResults(
  draft: DraftResponse,
  verifications: Map<string, VerificationResult>
): DraftResponse {
  const out: DraftResponse = { ...draft };
  for (const sectionKey of SECTION_KEYS) {
    const section = draft[sectionKey];
    if (!section?.claims) continue;
    const newClaims = section.claims.map((claim, claimIndex) => {
      const result = verifications.get(claimKey(sectionKey, claimIndex));
      if (!result) return claim;
      const newCitation: DraftCitation = { ...(claim.citation ?? {}) };

      switch (result.status) {
        case "verified":
          if (result.evidence) {
            newCitation.note = newCitation.note
              ? `${newCitation.note} | Verified: "${truncate(result.evidence, 180)}"`
              : `Verified: "${truncate(result.evidence, 180)}"`;
          }
          break;
        case "partial":
          newCitation.groundingType = "inference";
          newCitation.note = result.evidence
            ? `Partially supported. Source quote: "${truncate(result.evidence, 180)}". ${result.reasoning ?? ""}`.trim()
            : `Partially supported. ${result.reasoning ?? ""}`.trim();
          break;
        case "unsupported":
          newCitation.groundingType = "ai_knowledge";
          newCitation.sectionRef = null;
          newCitation.note =
            `Unsupported by cited section. ${result.reasoning ?? ""}`.trim();
          break;
        case "not_found":
          // Keep the citation but flag that we could not verify it.
          newCitation.note = newCitation.note
            ? `${newCitation.note} | Citation not verified (section not located in document text).`
            : "Citation not verified (section not located in document text).";
          break;
      }

      return { ...claim, citation: newCitation };
    });
    out[sectionKey] = { ...section, claims: newClaims };
  }
  return out;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

// --------------------------------------------------------------------------
// JSON parsing helpers (shared across stages).
// --------------------------------------------------------------------------
function parseDraftJson(response: Anthropic.Message): DraftResponse {
  const textBlock = response.content.find((b) => b.type === "text");
  const raw = textBlock?.type === "text" ? textBlock.text : "";
  const cleaned = raw
    .replace(/^```(?:json)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();
  return robustJsonParse(cleaned) as DraftResponse;
}

function parseCritiqueJson(response: Anthropic.Message): CritiqueResponse {
  const textBlock = response.content.find((b) => b.type === "text");
  const raw = textBlock?.type === "text" ? textBlock.text : "";
  const cleaned = raw
    .replace(/^```(?:json)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();
  const parsed = robustJsonParse(cleaned) as Partial<CritiqueResponse>;
  return {
    overallAssessment:
      typeof parsed.overallAssessment === "string"
        ? parsed.overallAssessment
        : "",
    missedIssues: Array.isArray(parsed.missedIssues) ? parsed.missedIssues : [],
    weakClaims: Array.isArray(parsed.weakClaims) ? parsed.weakClaims : [],
    counterReadings: Array.isArray(parsed.counterReadings)
      ? parsed.counterReadings
      : [],
    jurisdictionalConcerns: Array.isArray(parsed.jurisdictionalConcerns)
      ? parsed.jurisdictionalConcerns
      : [],
  };
}

// --------------------------------------------------------------------------
// Final normalization: parsed DraftResponse -> GeneratedSummary public shape.
// --------------------------------------------------------------------------
function normalizeToGeneratedSummary(
  draft: DraftResponse,
  sourceDocuments: SummarySourceDocument[]
): GeneratedSummary {
  const summary = normalizeSection("summary", draft.summary, sourceDocuments);
  const applicability = normalizeSection("applicability", draft.applicability, sourceDocuments);
  const keyCriteria = normalizeSection("keyCriteria", draft.keyCriteria, sourceDocuments);
  const whyItMatters = normalizeSection("whyItMatters", draft.whyItMatters, sourceDocuments);
  const complianceImplications = normalizeSection("complianceImplications", draft.complianceImplications, sourceDocuments);
  const exemptions = normalizeSection("exemptions", draft.exemptions, sourceDocuments);
  const penalties = normalizeSection("penalties", draft.penalties, sourceDocuments);
  const openQuestions = normalizeSection("openQuestions", draft.openQuestions, sourceDocuments);

  const sectionClaims: EntrySectionClaims = {};
  assignClaims(sectionClaims, "summary", summary.claims);
  assignClaims(sectionClaims, "applicability", applicability.claims);
  assignClaims(sectionClaims, "keyCriteria", keyCriteria.claims);
  assignClaims(sectionClaims, "whyItMatters", whyItMatters.claims);
  assignClaims(sectionClaims, "complianceImplications", complianceImplications.claims);
  assignClaims(sectionClaims, "exemptions", exemptions.claims);
  assignClaims(sectionClaims, "penalties", penalties.claims);
  assignClaims(sectionClaims, "openQuestions", openQuestions.claims);

  return {
    formalCitation: nullableString(draft.formalCitation),
    summary: summary.text || "No summary available.",
    applicability: applicability.text,
    keyCriteria: keyCriteria.text,
    whyItMatters: whyItMatters.text || "No business impact assessment available.",
    impactOnUs: nullableString(draft.impactOnUs),
    impactOnCustomers: nullableString(draft.impactOnCustomers),
    complianceImplications: complianceImplications.text || "No concrete compliance actions identified.",
    exemptions: exemptions.text,
    penalties: penalties.text,
    openQuestions: openQuestions.text,
    sectionConfidence: sanitizeSectionConfidence(draft.sectionConfidence),
    sectionClaims,
  };
}

// Normalize practitioner-output arrays. Each is a thin schema check that
// drops malformed entries and trims/length-caps strings to keep the UI sane.
export function normalizeEscalationTriggers(value: unknown): EscalationTrigger[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((raw): EscalationTrigger | null => {
      if (!raw || typeof raw !== "object") return null;
      const r = raw as Record<string, unknown>;
      const trigger = nullableString(r.trigger);
      const condition = nullableString(r.condition);
      if (!trigger || !condition) return null;
      return {
        trigger: trigger.slice(0, 280),
        condition: condition.slice(0, 400),
        sectionRef: nullableString(r.sectionRef),
      };
    })
    .filter((t): t is EscalationTrigger => t !== null);
}

export function normalizeComplianceChecklist(value: unknown): ComplianceChecklistItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((raw): ComplianceChecklistItem | null => {
      if (!raw || typeof raw !== "object") return null;
      const r = raw as Record<string, unknown>;
      const action = nullableString(r.action);
      if (!action) return null;
      return {
        action: action.slice(0, 320),
        owner: nullableString(r.owner)?.slice(0, 80) ?? "Unassigned",
        evidence: nullableString(r.evidence)?.slice(0, 280) ?? "",
        sectionRef: nullableString(r.sectionRef),
      };
    })
    .filter((t): t is ComplianceChecklistItem => t !== null);
}

export function normalizeThresholdTests(value: unknown): ThresholdTest[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((raw): ThresholdTest | null => {
      if (!raw || typeof raw !== "object") return null;
      const r = raw as Record<string, unknown>;
      const question = nullableString(r.question);
      const ifYes = nullableString(r.ifYes);
      const ifNo = nullableString(r.ifNo);
      if (!question || (!ifYes && !ifNo)) return null;
      return {
        question: question.slice(0, 280),
        sectionRef: nullableString(r.sectionRef),
        ifYes: (ifYes ?? "").slice(0, 280),
        ifNo: (ifNo ?? "").slice(0, 280),
      };
    })
    .filter((t): t is ThresholdTest => t !== null);
}

function assignClaims(target: EntrySectionClaims, key: EntrySectionKey, claims: EntryClaim[]) {
  if (claims.length > 0) {
    target[key] = claims;
  }
}

function normalizeSection(
  _key: EntrySectionKey,
  raw: unknown,
  sourceDocuments: SummarySourceDocument[]
): { text: string | null; claims: EntryClaim[] } {
  const section = raw && typeof raw === "object" ? (raw as DraftSection) : null;
  const intro = nullableString(section?.intro);
  const rawClaims = Array.isArray(section?.claims) ? section.claims : [];
  const claims = rawClaims
    .map((claim) => normalizeClaim(claim, sourceDocuments))
    .filter((claim): claim is EntryClaim => !!claim);

  return {
    text: buildSectionText(intro, claims.map((claim) => claim.text)),
    claims,
  };
}

function normalizeClaim(raw: DraftClaim, sourceDocuments: SummarySourceDocument[]): EntryClaim | null {
  const text = nullableString(raw?.text);
  if (!text) return null;
  return {
    text,
    citation: normalizeCitation(raw?.citation, sourceDocuments),
  };
}

function normalizeCitation(
  raw: DraftCitation | null | undefined,
  sourceDocuments: SummarySourceDocument[]
): EntryClaimCitation | null {
  if (!raw || typeof raw !== "object") return null;

  const index =
    typeof raw.documentIndex === "number" && Number.isFinite(raw.documentIndex)
      ? Math.max(1, Math.floor(raw.documentIndex))
      : null;
  const doc = index ? sourceDocuments[index - 1] ?? null : null;
  const sectionRef = nullableString(raw.sectionRef);
  const note = nullableString(raw.note);
  const groundingType = normalizeGroundingType(raw.groundingType);

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

function buildSectionText(intro: string | null, claims: string[]): string | null {
  const trimmedClaims = claims.map((claim) => claim.trim()).filter(Boolean);
  const parts: string[] = [];

  if (intro) parts.push(intro.trim());
  if (trimmedClaims.length > 0) {
    parts.push(trimmedClaims.map((claim) => `• ${claim}`).join("\n"));
  }

  const text = parts.join("\n\n").trim();
  return text || null;
}

function sanitizeSectionConfidence(value: unknown): EntrySectionConfidence {
  if (!value || typeof value !== "object") return {};
  return value as EntrySectionConfidence;
}

function nullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function robustJsonParse(text: string): JsonRecord {
  try {
    return JSON.parse(text) as JsonRecord;
  } catch {
    let fixed = "";
    let inString = false;
    let escaped = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];

      if (escaped) {
        fixed += ch;
        escaped = false;
        continue;
      }

      if (ch === "\\") {
        fixed += ch;
        escaped = true;
        continue;
      }

      if (ch === '"') {
        if (inString) {
          const rest = text.slice(i + 1).trimStart();
          if (
            rest.startsWith(",") || rest.startsWith("}") || rest.startsWith("]") ||
            rest.startsWith(":") || rest.length === 0
          ) {
            inString = false;
            fixed += ch;
          } else {
            fixed += '\\"';
          }
        } else {
          inString = true;
          fixed += ch;
        }
        continue;
      }

      if (inString && ch === "\n") {
        fixed += "\\n";
        continue;
      }

      if (inString && ch === "\r") {
        continue;
      }

      if (inString && ch === "\t") {
        fixed += "\\t";
        continue;
      }

      fixed += ch;
    }

    try {
      return JSON.parse(fixed) as JsonRecord;
    } catch {
      // Last-resort: the response was truncated mid-token (model hit
      // max_tokens). Close any unterminated string, then close any open
      // arrays/objects in the right order. Trailing commas are stripped.
      // We may lose the last partial item, but the rest of the structured
      // output is salvageable.
      return JSON.parse(repairTruncatedJson(fixed)) as JsonRecord;
    }
  }
}

function repairTruncatedJson(text: string): string {
  // Walk through, tracking whether we're in a string and the bracket stack.
  let inString = false;
  let escaped = false;
  const stack: string[] = []; // 'object' or 'array'

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") stack.push("object");
    else if (ch === "[") stack.push("array");
    else if (ch === "}" || ch === "]") stack.pop();
  }

  let repaired = text;

  // Close an unterminated string. If we ended escaped, the trailing backslash
  // is already inside the string and would invalidate the closer; drop it.
  if (inString) {
    if (escaped) repaired = repaired.slice(0, -1);
    repaired += '"';
  }

  // Strip a trailing partial token like `,"key":` or `, "ke` — anything after
  // the last balanced value. We do this by trimming trailing whitespace and
  // any dangling comma so the closers below are valid JSON.
  repaired = repaired.replace(/,\s*$/, "");

  // Close brackets/braces in reverse order.
  while (stack.length > 0) {
    repaired += stack.pop() === "array" ? "]" : "}";
  }

  return repaired;
}
