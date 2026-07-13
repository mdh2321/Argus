import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { getProfileContext } from "@/lib/profile-context";
import {
  buildCorpus,
  fetchSourceContents,
  getStoredDocTexts,
  getPrimaryTextDocs,
  type CorpusItem,
} from "@/lib/ask-corpus";
import { retrieveCorpus, retrieveChunks, type TextChunk } from "@/lib/ask-retrieval";
import { resolveScopes, type ScopedSource } from "@/lib/ask-scope";
import { locateQuoteOffsets } from "@/lib/summary-ai";
import {
  argusSystem,
  RIDER_QUICK,
  RIDER_DEEP,
  RIDER_CONVERSATIONAL,
} from "@/lib/argus-voice";
import {
  scoreClaimConfidence,
  bestCitation,
  minConfidence,
  overallConfidence,
} from "@/lib/ask-confidence";
import {
  researchWeb,
  webEvidenceContext,
  webEvidenceCitations,
  webDomainTier,
  MODEL_RESEARCH,
  type WebEvidence,
} from "@/lib/ask-web";
import type {
  AskAnswerTrace,
  AskConversationalAnswer,
  AskGroundingType,
  AskMessage,
  AskParagraph,
  AskScope,
  AskWebMode,
  AskArgusAction,
  AskArgusAnswer,
  AskArgusCitation,
  AskCitationPin,
  DeepReportSection,
} from "@/lib/ask-types";

const client = new Anthropic();

// ── Model tiering ───────────────────────────────────────────────
// Quick answers + conversational chat are latency-sensitive grounded
// synthesis → Sonnet 5. Deep reports are the real reasoning artefact →
// Opus 4.8. Haiku does the mechanical work (query expansion, verification).
export const MODEL_QUICK = "claude-sonnet-5";
export const MODEL_DEEP = "claude-opus-4-8";
export const MODEL_MECH = "claude-haiku-4-5-20251001";

// Sonnet 5 runs adaptive thinking by DEFAULT when the field is omitted —
// thinking tokens count against max_tokens, so the quick/conversational
// paths disable it explicitly to stay fast and budget-stable. Opus 4.8 runs
// without thinking when omitted, so deep reports opt IN to adaptive.
// Cast: this SDK version doesn't type the adaptive variant.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const THINKING_OFF = { type: "disabled" } as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const THINKING_ADAPTIVE = { type: "adaptive" } as any;

// Server-side web tools for conversational news Q&A. Dated tool versions select
// the dynamic-filtering variants; the SDK passes them through untyped, so we
// cast at the call site. (Citations + json_schema can't coexist, which is why
// the conversational path is unstructured and the structured paths use the
// two-stage research pipeline in ask-web.ts.)
const WEB_TOOLS = [
  { type: "web_search_20260209", name: "web_search", max_uses: 3 },
  { type: "web_fetch_20260209", name: "web_fetch", max_uses: 3 },
];

export interface AskContext {
  /** Prior turns in the conversation, oldest first. */
  history?: AskMessage[];
  /** When non-empty, constrain retrieval to this working set of source records. */
  scopes?: AskScope[];
  /** Web access mode (Phase 3). Defaults to "off". */
  web?: AskWebMode;
}

/** Context assembled for a single Ask turn, from the corpus or a scoped source. */
interface AssembledContext {
  context: string;
  citations: AskArgusCitation[];
  validIds: Set<string>;
  matchedCount: number;
  hasSourceContent: boolean;
  /** Present when the turn is scoped; drives prompt framing. */
  scopeLabel?: string;
  trace: AskAnswerTrace;
}

// ── Structured output schemas ───────────────────────────────────
// The API constrains the response to these schemas, so parsing can't drift.
// Confidence fields are deliberately absent from the quick schema — confidence
// is computed from grounding × authority (D1), never self-reported. Deep
// claims keep a self-reported confidence that can only DOWNGRADE the computed
// score.

const QUICK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    body: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          text: { type: "string" },
          sourceIds: { type: "array", items: { type: "string" } },
          groundingType: {
            type: "string",
            enum: ["direct_quote", "paraphrase", "inference", "ai_knowledge"],
          },
        },
        required: ["text", "sourceIds", "groundingType"],
      },
    },
    whyItMatters: { type: "string" },
    actions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { title: { type: "string" }, detail: { type: "string" } },
        required: ["title", "detail"],
      },
    },
    relatedQuestions: { type: "array", items: { type: "string" } },
  },
  required: ["body", "whyItMatters", "actions", "relatedQuestions"],
} as const;

const DEEP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    whyItMatters: { type: "string" },
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          heading: { type: "string" },
          content: { type: "string" },
          claims: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                text: { type: "string" },
                sourceId: { type: "string" },
                sourceType: {
                  type: "string",
                  enum: ["tracker", "digest", "knowledge", "signal", "web"],
                },
                groundingType: {
                  type: "string",
                  enum: ["direct_quote", "paraphrase", "inference", "ai_knowledge"],
                },
                confidence: { type: "string", enum: ["high", "medium", "low"] },
              },
              required: ["text", "groundingType", "confidence"],
            },
          },
        },
        required: ["heading", "content", "claims"],
      },
    },
    actions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { title: { type: "string" }, detail: { type: "string" }, href: { type: "string" } },
        required: ["title", "detail"],
      },
    },
    relatedQuestions: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "whyItMatters", "sections", "actions", "relatedQuestions"],
} as const;

const EXPANSION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { terms: { type: "array", items: { type: "string" } } },
  required: ["terms"],
} as const;

interface QuickPayload {
  body: { text: string; sourceIds: string[]; groundingType: AskGroundingType }[];
  whyItMatters: string;
  actions: AskArgusAction[];
  relatedQuestions: string[];
}

interface DeepPayload {
  summary: string;
  whyItMatters: string;
  sections: DeepReportSection[];
  actions: AskArgusAction[];
  relatedQuestions: string[];
}

// ── Trace helpers (Phase 0) ─────────────────────────────────────

function newTrace(webMode: AskWebMode, synthesisModel: string): AskAnswerTrace {
  return {
    retrieval: { mode: "fts", matched: 0, considered: 0 },
    sources: [],
    scopesDropped: [],
    webMode,
    webUsed: false,
    webSearches: 0,
    truncated: false,
    degraded: [],
    stages: [],
    models: { synthesis: synthesisModel },
  };
}

async function timed<T>(trace: AskAnswerTrace, name: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  try {
    return await fn();
  } finally {
    trace.stages.push({ name, ms: Date.now() - t0 });
  }
}

/** Turn accumulated trace state into human-readable degradation chips. */
function finalizeDegraded(trace: AskAnswerTrace): void {
  const notes: string[] = [];
  if (trace.retrieval.mode === "impact_fallback") {
    notes.push("No strong matches for this question — showing the highest-impact records instead.");
  }
  const failed = trace.sources.filter((s) => s.fetchFailed).length;
  if (failed > 0) {
    notes.push(`${failed} source URL${failed === 1 ? "" : "s"} couldn't be fetched.`);
  }
  if (trace.scopesDropped.length > 0) {
    notes.push(`Not found: ${trace.scopesDropped.join(", ")}.`);
  }
  if (trace.webMode === "on" && trace.webUsed && trace.webSearches === 0) {
    notes.push("Web research ran but found nothing citable.");
  }
  if (trace.truncated) {
    notes.push("The answer hit its length limit and may be cut short.");
  }
  trace.degraded = notes;
}

// ── Quick answer ────────────────────────────────────────────────

export async function answerAskArgus(query: string, ctx: AskContext = {}): Promise<AskArgusAnswer> {
  const cleanedQuery = query.trim();
  const history = ctx.history ?? [];
  const webMode = ctx.web ?? "off";
  const trace = newTrace(webMode, MODEL_QUICK);

  const assembled = ctx.scopes && ctx.scopes.length > 0
    ? await timed(trace, "Reading selected sources", () =>
        assembleScopedContext(ctx.scopes!, cleanedQuery, history, { passages: 6, sourceBudget: 14000 }, trace))
    : await timed(trace, "Searching the corpus", () =>
        assembleGlobalContext(cleanedQuery, history, {
          retrieveLimit: 6,
          fetchCount: 4,
          bodyLen: 1500,
          sourceLen: 15000,
        }, trace));

  const web = await runWebStage(webMode, cleanedQuery, assembled, trace);
  const profileContext = await getProfileContext();

  const prompt = `You are answering a legal-intelligence question about legislation and regulation across the Asia-Pacific region (AU, NZ, SG, JP, HK, IN, PH). Today's date is ${new Date().toISOString().slice(0, 10)}.

${profileContext ? `USER CONTEXT:\n${profileContext}\n\n` : ""}${transcript(history)}${scopeInstruction(assembled.scopeLabel)}A user has asked:
"${cleanedQuery}"

${contextHeading(assembled.scopeLabel)}

${assembled.context}${web.contextBlock ? `\n\n${web.contextBlock}` : ""}

${assembled.hasSourceContent
    ? "You have primary-source content above. Ground your answer in it — cite provisions, sections, or articles where possible."
    : assembled.scopeLabel
      ? "No primary-source text was available for this source — answer from the record's own summary above, and say plainly that you couldn't consult the underlying document."
      : "No source content was available. Answer from the record metadata and your knowledge, but be transparent about that in the prose."}

Write a direct, factual answer as paragraph blocks:
- body: 2-4 paragraphs. Each paragraph is 2-4 sentences and carries its own grounding:
  - sourceIds: the ids (the value after "id=") of the records above that this specific paragraph draws on. Empty array ONLY when the paragraph is general knowledge.
  - groundingType: be honest — "direct_quote" only when you are quoting or closely tracking source text; "ai_knowledge" for anything not backed by the records above. Never present AI knowledge as sourced fact.
- whyItMatters: 2-3 sentences on practical business and compliance impact.
- actions: 2-3 concrete next steps (omit generic filler).
- relatedQuestions: 3 specific follow-ups a lawyer would ask next.${
    history.length > 0 ? "\nThis is a follow-up — treat it in the context of the conversation above." : ""
  }`;

  let payload: QuickPayload;
  try {
    const { message } = await timed(trace, "Writing the answer", () =>
      createWithTruncationRetry({
        model: MODEL_QUICK,
        system: argusSystem(RIDER_QUICK),
        thinking: THINKING_OFF,
        maxTokens: 2500,
        prompt,
        schema: QUICK_SCHEMA,
        trace,
      }));
    payload = JSON.parse(textOf(message)) as QuickPayload;
  } catch (err) {
    console.error("Ask quick answer failed:", err);
    finalizeDegraded(trace);
    return errorAnswer(cleanedQuery, "quick", assembled.citations, assembled.matchedCount, trace);
  }

  // ── Post-process: validate citations, pin, score (Phases 0.3 + 2) ──
  const allCitations = [...assembled.citations, ...web.citations];
  const citationsById = new Map(allCitations.map((c) => [c.id, c]));
  const validIds = new Set([...assembled.validIds, ...web.evidence.map((e) => e.id)]);

  const pinCache = await buildPinCache(
    (payload.body ?? []).flatMap((p) => p.sourceIds).filter((id) => citationsById.get(id)?.kind === "tracker")
  );

  const paragraphs: AskParagraph[] = (payload.body ?? []).map((p) => {
    const sourceIds = (p.sourceIds ?? []).filter((id) => validIds.has(id));
    const grounding: AskGroundingType = sourceIds.length === 0 ? "ai_knowledge" : p.groundingType;
    const best = bestCitation(sourceIds, citationsById);
    const pin = pinForText(pinCache, sourceIds, p.text);
    const confidence = scoreClaimConfidence(grounding, best?.tier, pin?.quoteVerified ?? false);
    return { text: p.text, sourceIds, groundingType: grounding, confidence, pin };
  });

  const usedIds = new Set(paragraphs.flatMap((p) => p.sourceIds));
  const cited = allCitations.filter((c) => usedIds.has(c.id));
  const alsoConsulted = allCitations.filter((c) => !usedIds.has(c.id));

  finalizeDegraded(trace);

  const answer: AskArgusAnswer = {
    query: cleanedQuery,
    mode: "quick",
    confidence: overallConfidence(paragraphs),
    summary: paragraphs.map((p) => p.text).join("\n\n"),
    whyItMatters: payload.whyItMatters,
    actions: payload.actions.length > 0 ? payload.actions : fallbackActionsFromCitations(cited),
    citations: orderCitationsByAuthority(cited),
    alsoConsulted: orderCitationsByAuthority(alsoConsulted),
    relatedQuestions: payload.relatedQuestions,
    matchedCount: assembled.matchedCount,
    paragraphs,
    trace,
  };
  if (web.suggested) answer.webSuggested = true;
  return answer;
}

// ── Deep report (streamed) ──────────────────────────────────────

export type DeepReportStreamEvent =
  | { type: "stage"; name: string }
  | { type: "sources"; sources: AskArgusCitation[] }
  | { type: "progress"; chars: number }
  | { type: "done"; answer: AskArgusAnswer }
  | { type: "error"; message: string };

/**
 * Generate a deep report as a stream of events. Yields `stage` transitions and
 * incremental `progress` while the model writes, then a single `done` with the
 * parsed, citation-validated, confidence-scored report.
 */
export async function* streamDeepReport(
  query: string,
  ctx: AskContext = {}
): AsyncGenerator<DeepReportStreamEvent> {
  const cleanedQuery = query.trim();
  const history = ctx.history ?? [];
  const webMode = ctx.web ?? "off";
  const trace = newTrace(webMode, MODEL_DEEP);

  let assembled: AssembledContext;
  let web: WebStageResult;
  let prompt: string;

  yield { type: "stage", name: "Searching the corpus" };
  try {
    assembled = ctx.scopes && ctx.scopes.length > 0
      ? await timed(trace, "Reading selected sources", () =>
          assembleScopedContext(ctx.scopes!, cleanedQuery, history, { passages: 8, sourceBudget: 12000 }, trace))
      : await timed(trace, "Searching the corpus", () =>
          assembleGlobalContext(cleanedQuery, history, {
            retrieveLimit: 8,
            fetchCount: 6,
            bodyLen: 3000,
            sourceLen: 10000,
          }, trace));

    if (webMode === "on") yield { type: "stage", name: "Searching the web" };
    web = await runWebStage(webMode, cleanedQuery, assembled, trace);

    const profileContext = await getProfileContext();

    prompt = `You are generating an in-depth analytical report. Today's date is ${new Date().toISOString().slice(0, 10)}.

${profileContext ? `USER CONTEXT:\n${profileContext}\n\n` : ""}${transcript(history)}${scopeInstruction(assembled.scopeLabel)}A user has requested a deep report on:
"${cleanedQuery}"

${contextHeading(assembled.scopeLabel)}

${assembled.context}${web.contextBlock ? `\n\n${web.contextBlock}` : ""}

Generate a comprehensive, structured report:
- 3-5 substantive sections, each covering a different angle, 2-4 paragraphs of content.
- Each section: 2-8 claims with grounding metadata. Set groundingType honestly — use "ai_knowledge" for anything not backed by the records above, never present AI knowledge as sourced fact.
- When a claim is grounded in a specific record, set sourceId to that record's id from the context (the value after "id=").
- confidence on each claim: your own assessment of how well the cited evidence supports the claim (it can only lower the computed score, never raise it).
- actions: concrete recommendations, each with an href to the relevant /tracker/<id> where applicable.
- relatedQuestions: 3 specific follow-ups.${
      history.length > 0 ? "\nThis is a follow-up — build on the conversation above." : ""
    }`;
  } catch (err) {
    console.error("Ask deep report setup failed:", err);
    yield { type: "error", message: "Could not assemble the report context." };
    return;
  }

  // Sources-first: the records were retrieved before generation, so surface
  // them immediately — the reader sees the evidence the answer is built on
  // while the model is still writing, rather than a bare token counter.
  const allCitations = [...assembled.citations, ...web.citations];
  if (allCitations.length > 0) {
    yield { type: "sources", sources: allCitations };
  }
  yield { type: "stage", name: "Writing the report" };

  let payload: DeepPayload;
  try {
    let result = yield* streamSchemaCall(prompt, 12000, trace);
    if (result.truncated) {
      // One retry with a raised cap (Phase 0.4) — a truncated schema payload
      // is unparseable, so without this the whole report is lost.
      yield { type: "stage", name: "Answer hit its length limit — retrying with more room" };
      result = yield* streamSchemaCall(prompt, 20000, trace);
      trace.truncated = result.truncated;
    }
    payload = JSON.parse(result.text) as DeepPayload;
  } catch (err) {
    console.error("Ask deep report generation failed:", err);
    yield { type: "error", message: "The report could not be generated." };
    return;
  }

  // Validate cited sourceIds against the records actually in context — drop
  // citations the model invented so the UI never renders a phantom source.
  const citationsById = new Map(allCitations.map((c) => [c.id, c]));
  const validIds = new Set([...assembled.validIds, ...web.evidence.map((e) => e.id)]);

  const citedTrackerIds = (payload.sections || [])
    .flatMap((s) => s.claims || [])
    .map((c) => c.sourceId)
    .filter((id): id is string => !!id && citationsById.get(id)?.kind === "tracker");
  const pinCache = await buildPinCache(citedTrackerIds);

  const sections = (payload.sections || []).map((s) => ({
    ...s,
    claims: (s.claims || []).map((c) => {
      const sourceId = c.sourceId && validIds.has(c.sourceId) ? c.sourceId : undefined;
      const grounding: AskGroundingType = sourceId ? c.groundingType : c.groundingType === "ai_knowledge" ? "ai_knowledge" : "inference";
      const citation = sourceId ? citationsById.get(sourceId) : undefined;
      const pin = sourceId ? pinForText(pinCache, [sourceId], c.text) : null;
      const computed = scoreClaimConfidence(
        sourceId ? grounding : "ai_knowledge",
        citation?.tier,
        pin?.quoteVerified ?? false
      );
      return {
        ...c,
        sourceId,
        sourceType: sourceId ? c.sourceType : undefined,
        groundingType: sourceId ? grounding : "ai_knowledge" as const,
        // Self-report may only downgrade the computed score (D1).
        confidence: minConfidence(computed, c.confidence || "high"),
        pin,
      };
    }),
  }));

  const allClaims = sections.flatMap((s) => s.claims);
  const groundedClaims = allClaims.filter((c) => c.groundingType !== "ai_knowledge");
  const usedIds = new Set(allClaims.map((c) => c.sourceId).filter((id): id is string => !!id));
  const cited = allCitations.filter((c) => usedIds.has(c.id));
  const alsoConsulted = allCitations.filter((c) => !usedIds.has(c.id));

  finalizeDegraded(trace);

  const answer: AskArgusAnswer = {
    query: cleanedQuery,
    mode: "deep_report",
    confidence: overallConfidence(allClaims),
    summary: payload.summary,
    whyItMatters: payload.whyItMatters,
    actions: payload.actions || [],
    citations: orderCitationsByAuthority(cited),
    alsoConsulted: orderCitationsByAuthority(alsoConsulted),
    relatedQuestions: payload.relatedQuestions || [],
    matchedCount: assembled.matchedCount,
    reportSections: sections,
    groundingMetrics: {
      totalClaims: allClaims.length,
      groundedClaims: groundedClaims.length,
      groundingRatio: allClaims.length > 0 ? groundedClaims.length / allClaims.length : 0,
    },
    trace,
  };
  if (web.suggested) answer.webSuggested = true;

  yield { type: "done", answer };
}

/** One streamed schema-constrained deep call; reports truncation via stop_reason. */
async function* streamSchemaCall(
  prompt: string,
  maxTokens: number,
  trace: AskAnswerTrace
): AsyncGenerator<DeepReportStreamEvent, { text: string; truncated: boolean }> {
  const t0 = Date.now();
  const stream = client.messages.stream({
    model: MODEL_DEEP,
    max_tokens: maxTokens,
    system: argusSystem(RIDER_DEEP),
    thinking: THINKING_ADAPTIVE,
    messages: [{ role: "user", content: prompt }],
    output_config: { format: { type: "json_schema", schema: DEEP_SCHEMA } },
  });

  let chars = 0;
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      chars += event.delta.text.length;
      yield { type: "progress", chars };
    }
  }

  const final = await stream.finalMessage();
  trace.stages.push({ name: `Writing (${maxTokens} cap)`, ms: Date.now() - t0 });
  return { text: textOf(final), truncated: final.stop_reason === "max_tokens" };
}

// ── Web stage (Phase 3) ─────────────────────────────────────────

interface WebStageResult {
  evidence: WebEvidence[];
  citations: AskArgusCitation[];
  contextBlock: string;
  /** Auto mode found weak grounding — the answer should offer a web re-run. */
  suggested: boolean;
}

const NO_WEB: WebStageResult = { evidence: [], citations: [], contextBlock: "", suggested: false };

async function runWebStage(
  webMode: AskWebMode,
  query: string,
  assembled: AssembledContext,
  trace: AskAnswerTrace
): Promise<WebStageResult> {
  if (webMode === "off") return NO_WEB;

  const weak = assembled.trace.retrieval.mode === "impact_fallback" || !assembled.hasSourceContent;
  if (webMode === "auto") {
    // Auto never searches silently — it surfaces the offer (Phase 3.4).
    return { ...NO_WEB, suggested: weak };
  }

  const contextHint = assembled.citations
    .slice(0, 6)
    .map((c) => `- ${c.title} (${c.meta})`)
    .join("\n");

  const research = await timed(trace, "Searching the web", () => researchWeb(query, contextHint));
  trace.webUsed = true;
  trace.webSearches = research.searches;
  trace.models.research = MODEL_RESEARCH;

  if (research.evidence.length === 0) {
    return NO_WEB;
  }
  return {
    evidence: research.evidence,
    citations: webEvidenceCitations(research.evidence),
    contextBlock: webEvidenceContext(research.evidence),
    suggested: false,
  };
}

// ── Truncation-safe structured call (Phase 0.4) ─────────────────

async function createWithTruncationRetry(args: {
  model: string;
  system: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  thinking: any;
  maxTokens: number;
  prompt: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: any;
  trace: AskAnswerTrace;
}): Promise<{ message: Anthropic.Message }> {
  const call = (cap: number) =>
    client.messages.create({
      model: args.model,
      max_tokens: cap,
      system: args.system,
      thinking: args.thinking,
      messages: [{ role: "user", content: args.prompt }],
      output_config: { format: { type: "json_schema", schema: args.schema } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any) as Promise<Anthropic.Message>;

  let message = await call(args.maxTokens);
  if (message.stop_reason === "max_tokens") {
    message = await call(args.maxTokens * 2);
    if (message.stop_reason === "max_tokens") args.trace.truncated = true;
  }
  return { message };
}

// ── Shared helpers ──────────────────────────────────────────────

function buildCitations(items: CorpusItem[]): AskArgusCitation[] {
  return items.map((item) => ({
    id: item.id,
    kind: item.kind,
    title: item.title,
    href: item.href,
    meta: item.meta,
    sourceLabel: item.sourceLabel,
    externalUrl: item.externalUrl,
    // §3.3 — realm defaults to the entry's analysis fields; pin enrichment may
    // promote it to "instrument" when the claim grounds in the instrument text.
    realm: "analysis",
    tier: item.authorityTier,
    formalCitation: item.formalCitation ?? null,
  }));
}

// Authority-first ordering (§3.3): primary legislation → regulator → commentary
// → web. Ties keep their retrieval order (stable sort).
const TIER_RANK: Record<string, number> = {
  primary_legislation: 0,
  regulator: 1,
  legal_commentary: 2,
  commentary: 2,
  industry: 3,
  media: 4,
  web: 5,
};
export function orderCitationsByAuthority(citations: AskArgusCitation[]): AskArgusCitation[] {
  return citations
    .map((c, i) => ({ c, i }))
    .sort((a, b) => {
      const ra = TIER_RANK[a.c.tier ?? (a.c.realm === "web" ? "web" : "commentary")] ?? 3;
      const rb = TIER_RANK[b.c.tier ?? (b.c.realm === "web" ? "web" : "commentary")] ?? 3;
      return ra - rb || a.i - b.i;
    })
    .map((x) => x.c);
}

// ── Claim-level pins (Phase 2.2) ────────────────────────────────
// Pins are retrieved with the CLAIM/PARAGRAPH text as the query (not the
// user's original question), so each paragraph deep-links to the passage
// that grounds *it*. All local FTS over already-stored text — zero tokens.

interface PinCache {
  docs: Map<string, { docId: string; fullText: string; chunks: TextChunk[] }>;
}

async function buildPinCache(trackerIds: string[]): Promise<PinCache> {
  const unique = [...new Set(trackerIds)];
  const primaryDocs = await getPrimaryTextDocs(unique);
  const docs = new Map<string, { docId: string; fullText: string; chunks: TextChunk[] }>();
  for (const [entryId, doc] of primaryDocs) {
    docs.set(entryId, { ...doc, chunks: chunkDocText(doc.docId, doc.fullText) });
  }
  return { docs };
}

function pinForText(
  cache: PinCache,
  sourceIds: string[],
  text: string
): (AskCitationPin & { entryId: string }) | null {
  for (const id of sourceIds) {
    const doc = cache.docs.get(id);
    if (!doc) continue;
    const best = retrieveChunks(doc.chunks, text, 1)[0];
    if (!best) continue;
    const quote = representativeSentence(best.text);
    if (!quote) continue;
    const located = locateQuoteOffsets(doc.fullText, quote);
    return {
      entryId: id,
      sourceDocumentId: doc.docId,
      sectionRef: guessSectionRef(quote),
      quote: located?.matched ?? quote,
      quoteVerified: !!located,
      quoteStart: located?.start ?? null,
      quoteEnd: located?.end ?? null,
    };
  }
  return null;
}

/**
 * Attach instrument-text evidence pins to tracker citations (§3.1/§3.2), for
 * the source ribbon. Claim-level pins (Phase 2) are separate and use the claim
 * text; this citation-level pass uses the original query.
 */
async function enrichCitationsWithPins(
  citations: AskArgusCitation[],
  query: string
): Promise<AskArgusCitation[]> {
  const trackerIds = citations.filter((c) => c.kind === "tracker").map((c) => c.id);
  const cache = await buildPinCache(trackerIds);
  if (cache.docs.size === 0) return citations;

  return citations.map((c) => {
    if (c.kind !== "tracker" || !cache.docs.has(c.id)) return c;
    const pin = pinForText(cache, [c.id], query);
    if (!pin) return c;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { entryId: _entryId, ...bare } = pin;
    return { ...c, realm: "instrument" as const, pin: bare };
  });
}

// Split a document into ~1500-char passages on paragraph boundaries for
// passage retrieval. Mirrors the scoped-Ask chunking budget.
function chunkDocText(docId: string, fullText: string): TextChunk[] {
  const CHUNK = 1500;
  const paras = fullText.split(/\n{2,}/);
  const chunks: TextChunk[] = [];
  let buf = "";
  let idx = 0;
  const flush = () => {
    const text = buf.trim();
    if (text) chunks.push({ id: `${docId}:${idx}`, index: idx, text });
    idx++;
    buf = "";
  };
  for (const p of paras) {
    if ((buf + "\n\n" + p).length > CHUNK && buf) flush();
    buf += (buf ? "\n\n" : "") + p;
  }
  flush();
  return chunks;
}

// The most substantial sentence in a passage — long enough to anchor, short
// enough to quote. Falls back to a trimmed prefix.
function representativeSentence(passage: string): string | null {
  const sentences = passage
    .replace(/\s+/g, " ")
    .split(/(?<=[.;:])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 40 && s.length <= 240);
  if (sentences.length > 0) {
    return sentences.sort((a, b) => b.length - a.length)[0];
  }
  const trimmed = passage.replace(/\s+/g, " ").trim();
  return trimmed.length >= 20 ? trimmed.slice(0, 200) : null;
}

// Best-effort section reference from a quote (e.g. "s 13G", "Article 4",
// "Part 3"). Null when nothing recognisable is present.
function guessSectionRef(quote: string): string | null {
  const m = quote.match(/\b(?:s(?:ection)?|art(?:icle)?|reg(?:ulation)?|part|sched(?:ule)?)\.?\s*\d+[A-Za-z]?(?:\([^)]*\))?/i);
  return m ? m[0].replace(/\s+/g, " ").trim() : null;
}

function buildContext(
  items: CorpusItem[],
  sourceContents: Map<string, string>,
  storedDocs: Map<string, string>,
  opts: { bodyLen: number; sourceLen: number }
): string {
  const parts: string[] = [];
  for (const item of items) {
    let section = `[${item.kind.toUpperCase()} · id=${item.id}] ${item.title}\nMeta: ${item.meta}\n`;
    if (item.body) section += `Record content: ${item.body.slice(0, opts.bodyLen)}\n`;
    const stored = storedDocs.get(item.id);
    const fetched = sourceContents.get(item.id);
    // Delimit source material so instructions inside it are inert (Phase 0.5):
    // stored docs are vetted evidence; live-fetched pages are untrusted.
    if (stored) {
      section += `\nPRIMARY SOURCE DOCUMENT:\n<source_text id="${item.id}">\n${stored.slice(0, opts.sourceLen)}\n</source_text>\n`;
    } else if (fetched) {
      section += `\nSOURCE URL CONTENT:\n<untrusted_source id="${item.id}">\n${fetched.slice(0, opts.sourceLen)}\n</untrusted_source>\n`;
    }
    if (item.externalUrl) section += `Source URL: ${item.externalUrl}\n`;
    parts.push(section);
  }
  return parts.join("\n---\n");
}

/** Compact transcript of recent turns to give the model conversational context. */
function transcript(history: AskMessage[]): string {
  if (history.length === 0) return "";
  const lines = history.slice(-6).map((m) => `${m.role === "user" ? "Q" : "A"}: ${m.content}`);
  return `CONVERSATION SO FAR (most recent last):\n${lines.join("\n")}\n\n`;
}

/**
 * Short follow-ups ("what about processors?") don't retrieve well on their own.
 * Prepend the most recent question so retrieval has enough signal.
 */
function retrievalQuery(query: string, history: AskMessage[]): string {
  const tokens = query.toLowerCase().match(/[a-z0-9]+/g) || [];
  if (tokens.length >= 4 || history.length === 0) return query;
  const lastUser = [...history].reverse().find((m) => m.role === "user");
  return lastUser ? `${lastUser.content} ${query}` : query;
}

// ── Query expansion (Phase 4.1) ─────────────────────────────────
// Only runs when lexical retrieval comes back weak — zero cost on the common
// path. Haiku rewrites the question into the statute names, regulator
// acronyms, and synonyms the corpus actually uses.

async function expandQueryTerms(query: string): Promise<string[]> {
  try {
    const response = await client.messages.create({
      model: MODEL_MECH,
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content: `A lexical search over an APAC legal-intelligence corpus (tracked legislation, regulator guidance, digests) found few matches for this query:

"${query}"

Return up to 8 additional search terms that the relevant records would actually contain: statute short titles, regulator names/acronyms, legal terms of art, jurisdiction-specific synonyms. Single words or short phrases only.`,
        },
      ],
      output_config: { format: { type: "json_schema", schema: EXPANSION_SCHEMA } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any) as Anthropic.Message;
    const parsed = JSON.parse(textOf(response)) as { terms: string[] };
    return (parsed.terms || []).slice(0, 8);
  } catch (err) {
    console.error("Ask query expansion failed:", err);
    return [];
  }
}

// ── Context assembly ────────────────────────────────────────────

interface GlobalOpts {
  retrieveLimit: number;
  fetchCount: number;
  bodyLen: number;
  sourceLen: number;
}

// How many next-best matches to list as titles-only periphery (Phase 4.2).
const PERIPHERY_COUNT = 20;
// Retrieval below this many hits triggers Haiku query expansion (Phase 4.1).
const EXPANSION_THRESHOLD = 4;

/** Assemble context by retrieving across the whole corpus (the default path). */
async function assembleGlobalContext(
  query: string,
  history: AskMessage[],
  opts: GlobalOpts,
  trace: AskAnswerTrace
): Promise<AssembledContext> {
  const corpus = await buildCorpus();
  const rq = retrievalQuery(query, history);
  const wanted = opts.retrieveLimit + PERIPHERY_COUNT;

  let retrieval = retrieveCorpus(corpus, rq, wanted);
  let retrievalMode: AskAnswerTrace["retrieval"]["mode"] = retrieval.mode;

  if (retrieval.mode === "impact_fallback" || retrieval.totalHits < EXPANSION_THRESHOLD) {
    const terms = await expandQueryTerms(rq);
    if (terms.length > 0) {
      const expanded = retrieveCorpus(corpus, rq, wanted, terms);
      if (expanded.mode === "fts" && expanded.totalHits > retrieval.totalHits) {
        retrieval = expanded;
        retrievalMode = "fts_expanded";
      }
    }
  }

  const top = retrieval.matches.slice(0, opts.retrieveLimit).map((m) => m.item);
  const periphery = retrieval.matches.slice(opts.retrieveLimit).map((m) => m.item);

  trace.retrieval = {
    mode: retrievalMode,
    matched: retrieval.mode === "impact_fallback" ? 0 : Math.min(retrieval.totalHits, retrieval.matches.length),
    considered: corpus.length,
  };

  // Stored docs first; live-fetch only what stored text doesn't already cover.
  const storedDocs = await getStoredDocTexts(
    top.filter((i) => i.kind === "tracker" && !i.id.startsWith("ki:")).map((i) => i.id).slice(0, opts.fetchCount)
  );
  const needsFetch = top.slice(0, opts.fetchCount).filter((i) => !storedDocs.has(i.id));
  const fetched = await fetchSourceContents(needsFetch);

  for (const item of top) {
    const failedFetch = fetched.failed.some((f) => f.id === item.id);
    trace.sources.push({
      id: item.id,
      label: item.title,
      grounding: storedDocs.has(item.id)
        ? "stored_doc"
        : fetched.cached.has(item.id)
          ? "cached_fetch"
          : fetched.contents.has(item.id)
            ? "live_fetch"
            : "record_only",
      ...(failedFetch ? { fetchFailed: true } : {}),
    });
  }

  // §3.2/§3.3 — pin instrument-text passages beneath entry citations, then
  // order authority-first (primary legislation before regulator before
  // commentary before web).
  const pinned = await enrichCitationsWithPins(buildCitations(top), rq);

  let context = buildContext(top, fetched.contents, storedDocs, {
    bodyLen: opts.bodyLen,
    sourceLen: opts.sourceLen,
  });

  // Titles-only periphery (Phase 4.2): the model learns what else the tracker
  // holds without paying for bodies — it can point at leads it didn't read.
  if (periphery.length > 0) {
    const lines = periphery.map((p) => `- [${p.kind}] ${p.title} (${p.meta})`);
    context += `\n\n---\n\nOTHER TRACKED RECORDS (titles only — you have NOT read these; offer them as leads where relevant, never cite them as evidence):\n${lines.join("\n")}`;
  }

  return {
    context,
    citations: orderCitationsByAuthority(pinned),
    validIds: new Set(top.map((i) => i.id)),
    matchedCount: retrieval.mode === "impact_fallback" ? 0 : retrieval.totalHits,
    hasSourceContent: fetched.contents.size > 0 || storedDocs.size > 0,
    trace,
  };
}

interface ScopedOpts {
  passages: number;
  sourceBudget: number;
}

/** Assemble context from a working set of one or more sources (the scoped-Ask path). */
async function assembleScopedContext(
  scopes: AskScope[],
  query: string,
  history: AskMessage[],
  opts: ScopedOpts,
  trace: AskAnswerTrace
): Promise<AssembledContext> {
  const { resolved, dropped } = await resolveScopes(scopes);
  trace.scopesDropped = dropped;
  trace.retrieval = { mode: "scoped", matched: resolved.length, considered: scopes.length };

  if (resolved.length === 0) {
    return {
      context: `(The requested source(s) could not be found.)`,
      citations: [],
      validIds: new Set(),
      matchedCount: 0,
      hasSourceContent: false,
      scopeLabel: scopes[0]?.label || "the selected sources",
      trace,
    };
  }

  // Split the passage and character budgets across the selected sources so one
  // long document can't crowd the others out of the context window.
  const perSourcePassages = Math.max(2, Math.floor(opts.passages / resolved.length));
  const perSourceBudget = Math.floor(opts.sourceBudget / resolved.length);

  const sections = resolved.map((source) => {
    // Pick the most relevant passages, then restore document order so the model
    // reads them top-to-bottom rather than in BM25-rank order.
    const picked = retrieveChunks(source.passages, retrievalQuery(query, history), perSourcePassages)
      .sort((a, b) => a.index - b.index);
    return scopedContextString(source, picked, perSourceBudget);
  });

  for (const source of resolved) {
    trace.sources.push({
      id: source.citation.id,
      label: source.label,
      grounding: source.hasFullText ? "stored_doc" : "record_only",
    });
  }

  const scopeLabel =
    resolved.length === 1 ? resolved[0].label : `${resolved.length} selected sources`;

  return {
    context: sections.join("\n\n---\n\n"),
    citations: resolved.map((r) => r.citation),
    validIds: new Set(resolved.map((r) => r.citation.id)),
    matchedCount: resolved.reduce((n, r) => n + r.passages.length, 0),
    hasSourceContent: resolved.some((r) => r.hasFullText),
    scopeLabel,
    trace,
  };
}

function scopedContextString(
  resolved: ScopedSource,
  passages: { index: number; text: string }[],
  budget: number
): string {
  const c = resolved.citation;
  const header =
    `[${c.kind.toUpperCase()} · id=${c.id}] ${resolved.label}\n` +
    `Meta: ${c.meta}\n` +
    (resolved.externalUrl ? `Source URL: ${resolved.externalUrl}\n` : "");

  if (passages.length === 0) {
    return `${header}\n(No source text was available for this record.)\n`;
  }

  const body = passages
    .map((p) => `[Passage ${p.index}]\n${p.text}`)
    .join("\n\n")
    .slice(0, budget);

  return `${header}\nRELEVANT PASSAGES FROM THIS SOURCE:\n<source_text id="${c.id}">\n${body}\n</source_text>\n`;
}

/** Instruction block that pins the answer to a single source, when scoped. */
function scopeInstruction(label?: string): string {
  if (!label) return "";
  return (
    `This question is SCOPED to a single source: "${label}". Answer ONLY from that ` +
    `source's content below. If it does not address the question, say so plainly ` +
    `rather than drawing on outside knowledge.\n\n`
  );
}

function contextHeading(label?: string): string {
  return label
    ? `Relevant passages from "${label}":`
    : `Most relevant records from Argus's tracker, digest, knowledge store, and signals, with any source content fetched from official URLs:`;
}

function fallbackActionsFromCitations(citations: AskArgusCitation[]): AskArgusAction[] {
  const first = citations[0];
  if (!first) return [];
  return [
    {
      title: "Open the cited source",
      detail: "Use the linked citation to validate this answer against the underlying record.",
      href: first.href,
    },
  ];
}

function errorAnswer(
  query: string,
  mode: "quick" | "deep_report",
  citations: AskArgusCitation[],
  matchedCount: number,
  trace: AskAnswerTrace
): AskArgusAnswer {
  return {
    query,
    mode,
    confidence: "low",
    summary: "Argus couldn't complete that request. Please try again.",
    whyItMatters: "",
    actions: [],
    citations,
    relatedQuestions: [],
    matchedCount,
    trace,
  };
}

function textOf(message: { content: Array<{ type: string; text?: string }> }): string {
  const block = message.content.find((b) => b.type === "text");
  return block && "text" in block ? (block.text ?? "") : "";
}

// ── Conversational news Q&A (streamed) ──────────────────────────
// News-story scope is a quick, text-message-style chat — not a structured
// briefing. Because web-search citations and json_schema output can't coexist,
// this path is a single unstructured streaming call. Web tools are attached
// only when the web toggle allows it (Phase 3) — "off" means story-text only.

export type ConversationalStreamEvent =
  | { type: "delta"; text: string }
  | { type: "done"; answer: AskConversationalAnswer }
  | { type: "error"; message: string };

const CONVERSATIONAL_SOURCE_BUDGET = 7000;

export async function* streamConversationalAnswer(
  query: string,
  ctx: AskContext = {}
): AsyncGenerator<ConversationalStreamEvent> {
  const cleanedQuery = query.trim();
  const history = ctx.history ?? [];
  const scopes = ctx.scopes ?? [];
  // News chat historically always had web; default "auto" behaves like "on"
  // here (a single capped conversational call, not the two-stage pipeline).
  const webMode = ctx.web ?? "auto";
  const webAllowed = webMode !== "off";
  const trace = newTrace(webMode, MODEL_QUICK);

  let resolved: ScopedSource[];
  let scopeLabel: string;
  let prompt: string;
  try {
    const resolution = await timed(trace, "Reading the story", () => resolveScopes(scopes));
    resolved = resolution.resolved;
    trace.scopesDropped = resolution.dropped;
    trace.retrieval = { mode: "scoped", matched: resolved.length, considered: scopes.length };
    if (resolved.length === 0) {
      yield { type: "error", message: "That story could not be found." };
      return;
    }
    scopeLabel = resolved.length === 1 ? resolved[0].label : `${resolved.length} stories`;

    for (const source of resolved) {
      trace.sources.push({
        id: source.citation.id,
        label: source.label,
        grounding: source.hasFullText ? "stored_doc" : "record_only",
      });
    }

    const perSourceBudget = Math.floor(CONVERSATIONAL_SOURCE_BUDGET / resolved.length);
    const storyBlocks = resolved
      .map((r) => `# ${r.label}\n<untrusted_source id="${r.citation.id}">\n${sourceBodyText(r, perSourceBudget)}\n</untrusted_source>`)
      .join("\n\n---\n\n");

    const profileContext = await getProfileContext();

    prompt = `Today's date is ${new Date().toISOString().slice(0, 10)}. The user is asking quick, conversational follow-up questions about a specific news story (or stories).

${profileContext ? `USER CONTEXT:\n${profileContext}\n\n` : ""}${transcript(history)}STORY / STORIES IN SCOPE:
${storyBlocks}

The user asks:
"${cleanedQuery}"

${webAllowed
    ? `Ground your answer in the story text above first. When it doesn't cover the question — or the user asks about developments, reactions, or related context — use web_search / web_fetch to find current, sourced information, and cite what you find. If you're unsure or sources conflict, say so plainly.`
    : `Answer ONLY from the story text above. Web access is off for this conversation — when the story doesn't cover the question, say so plainly rather than guessing or drawing on outside knowledge.`}${
      history.length > 0 ? "\nThis is a follow-up — treat it in the context of the conversation above." : ""
    }`;
  } catch (err) {
    console.error("Ask conversational setup failed:", err);
    yield { type: "error", message: "Could not assemble the conversation." };
    return;
  }

  try {
    const t0 = Date.now();
    const stream = client.messages.stream({
      model: MODEL_QUICK,
      max_tokens: 1500,
      system: argusSystem(RIDER_CONVERSATIONAL),
      thinking: THINKING_OFF,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(webAllowed ? { tools: WEB_TOOLS as any } : {}),
      messages: [{ role: "user", content: prompt }],
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield { type: "delta", text: event.delta.text };
      }
    }

    const final = await stream.finalMessage();
    trace.stages.push({ name: "Writing the reply", ms: Date.now() - t0 });
    trace.truncated = final.stop_reason === "max_tokens";

    const blocks = final.content as ContentBlockLike[];
    const content = collectText(blocks);
    const citations = extractWebCitations(blocks, resolved);
    trace.webUsed = webAllowed && blocks.some((b) => b.type === "server_tool_use");
    trace.webSearches = blocks.filter((b) => b.type === "server_tool_use").length;
    finalizeDegraded(trace);

    yield {
      type: "done",
      answer: { query: cleanedQuery, content, citations: orderCitationsByAuthority(citations), scopeLabel, trace },
    };
  } catch (err) {
    console.error("Ask conversational generation failed:", err);
    yield { type: "error", message: "Argus couldn't answer that. Please try again." };
  }
}

/** Linear text of a scoped source's passages, in document order, capped to budget. */
function sourceBodyText(source: ScopedSource, budget: number): string {
  const text = source.passages.map((p) => p.text).join("\n\n");
  return text.length > budget ? `${text.slice(0, budget)}…` : text;
}

// Web-search response blocks aren't fully typed in this SDK version; parse
// defensively over a loose shape.
interface ContentBlockLike {
  type: string;
  text?: string;
  citations?: Array<{ type?: string; url?: string; title?: string }>;
  content?: Array<{ type?: string; url?: string; title?: string }>;
}

function collectText(blocks: ContentBlockLike[]): string {
  return blocks
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("")
    .trim();
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Build the source list for a conversational answer: the scoped story (always,
 * so the original article is listed) plus the web pages the model actually
 * cited — falling back to the pages it searched when nothing was cited inline.
 * Web citations are domain-tiered so official pages rank as official evidence.
 */
function extractWebCitations(
  blocks: ContentBlockLike[],
  resolved: ScopedSource[]
): AskArgusCitation[] {
  const out: AskArgusCitation[] = [];
  const seen = new Set<string>();

  for (const r of resolved) {
    const key = r.externalUrl || r.citation.id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r.citation);
  }

  const cited: { url: string; title: string }[] = [];
  const searched: { url: string; title: string }[] = [];
  for (const block of blocks) {
    if (block.type === "text" && Array.isArray(block.citations)) {
      for (const c of block.citations) {
        if (c?.url) cited.push({ url: c.url, title: c.title || c.url });
      }
    }
    if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const r of block.content) {
        if (r?.type === "web_search_result" && r.url) searched.push({ url: r.url, title: r.title || r.url });
      }
    }
  }

  for (const c of cited.length > 0 ? cited : searched) {
    if (seen.has(c.url)) continue;
    seen.add(c.url);
    const tier = webDomainTier(c.url);
    out.push({
      id: c.url,
      kind: "web",
      title: c.title,
      href: c.url,
      meta: hostOf(c.url),
      sourceLabel: hostOf(c.url),
      externalUrl: c.url,
      realm: "web",
      tier: tier === "web" ? "web" : tier,
    });
  }

  return out;
}
