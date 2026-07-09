import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { getProfileContext } from "@/lib/profile-context";
import {
  buildCorpus,
  fetchSourceContents,
  getStoredDocTexts,
  type CorpusItem,
} from "@/lib/ask-corpus";
import { retrieveCorpus, retrieveChunks } from "@/lib/ask-retrieval";
import { resolveScopes, type ScopedSource } from "@/lib/ask-scope";
import type {
  AskConversationalAnswer,
  AskMessage,
  AskScope,
  AskSentinelAction,
  AskSentinelAnswer,
  AskSentinelCitation,
  DeepReportSection,
} from "@/lib/ask-types";

const client = new Anthropic();
const MODEL = "claude-sonnet-4-6";

// Server-side web tools for conversational news Q&A. Dated tool versions select
// the dynamic-filtering variants; the SDK passes them through untyped, so we
// cast at the call site. (Citations + json_schema can't coexist, which is why
// the conversational path is unstructured.)
const WEB_TOOLS = [
  { type: "web_search_20260209", name: "web_search" },
  { type: "web_fetch_20260209", name: "web_fetch" },
];

export interface AskContext {
  /** Prior turns in the conversation, oldest first. */
  history?: AskMessage[];
  /** When non-empty, constrain retrieval to this working set of source records. */
  scopes?: AskScope[];
}

/** Context assembled for a single Ask turn, from the corpus or a scoped source. */
interface AssembledContext {
  context: string;
  citations: AskSentinelCitation[];
  validIds: Set<string>;
  matchedCount: number;
  hasSourceContent: boolean;
  /** Present when the turn is scoped to one source; drives prompt framing. */
  scopeLabel?: string;
}

// ── Structured output schemas ───────────────────────────────────
// Replaces the old "Return ONLY valid JSON" prompting + fragile JSON.parse.
// The API constrains the response to these schemas, so parsing can't drift.

const QUICK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
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
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
  required: ["summary", "whyItMatters", "actions", "relatedQuestions", "confidence"],
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
                sourceType: { type: "string", enum: ["tracker", "digest", "knowledge", "signal"] },
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
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
  required: ["summary", "whyItMatters", "sections", "actions", "relatedQuestions", "confidence"],
} as const;

interface QuickPayload {
  summary: string;
  whyItMatters: string;
  actions: AskSentinelAction[];
  relatedQuestions: string[];
  confidence: "high" | "medium" | "low";
}

interface DeepPayload {
  summary: string;
  whyItMatters: string;
  sections: DeepReportSection[];
  actions: AskSentinelAction[];
  relatedQuestions: string[];
  confidence: "high" | "medium" | "low";
}

// ── Quick answer ────────────────────────────────────────────────

export async function answerAskSentinel(query: string, ctx: AskContext = {}): Promise<AskSentinelAnswer> {
  const cleanedQuery = query.trim();
  const history = ctx.history ?? [];
  const answerMode = detectMode(cleanedQuery);

  const assembled = ctx.scopes && ctx.scopes.length > 0
    ? await assembleScopedContext(ctx.scopes, cleanedQuery, history, { passages: 6, sourceBudget: 14000 })
    : await assembleGlobalContext(cleanedQuery, history, {
        retrieveLimit: 6,
        citeAll: false,
        fetchCount: 4,
        bodyLen: 1500,
        sourceLen: 15000,
      });

  const profileContext = await getProfileContext();

  const prompt = `You are Sentinel, a legal intelligence assistant tracking legislation and regulation across the Asia-Pacific region (AU, NZ, SG, JP, HK, IN, PH). Today's date is ${new Date().toISOString().slice(0, 10)}.

${profileContext ? `USER CONTEXT:\n${profileContext}\n\n` : ""}${transcript(history)}${scopeInstruction(assembled.scopeLabel)}A user has asked:
"${cleanedQuery}"

Answer mode: ${answerMode}

${contextHeading(assembled.scopeLabel)}

${assembled.context}

${assembled.hasSourceContent
    ? "You have primary-source content above. Ground your answer in it — cite provisions, sections, or articles where possible."
    : assembled.scopeLabel
      ? "No primary-source text was available for this source — answer from the record's own summary above, and say plainly that you couldn't consult the underlying document."
      : "No source content was available. Answer from the record metadata and your knowledge, but be transparent about confidence."}

Write a direct, factual answer.
- summary: 2-4 sentences answering the question. Be specific; cite provisions when you have source content.
- whyItMatters: 2-3 sentences on practical business and compliance impact.
- actions: 2-3 concrete next steps (omit generic filler).
- relatedQuestions: 3 specific follow-ups a lawyer would ask next.
- confidence: high if grounded in source content, medium if based on record metadata, low if mostly general knowledge.${
    history.length > 0 ? "\nThis is a follow-up — treat it in the context of the conversation above." : ""
  }`;

  let payload: QuickPayload;
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
      output_config: { format: { type: "json_schema", schema: QUICK_SCHEMA } },
    });
    payload = JSON.parse(textOf(response)) as QuickPayload;
  } catch (err) {
    console.error("Ask quick answer failed:", err);
    return errorAnswer(cleanedQuery, "quick", answerMode, assembled.citations, assembled.matchedCount);
  }

  return {
    query: cleanedQuery,
    mode: "quick",
    answerMode,
    confidence: payload.confidence || (assembled.hasSourceContent ? "medium" : "low"),
    summary: payload.summary,
    whyItMatters: payload.whyItMatters,
    actions: payload.actions.length > 0 ? payload.actions : fallbackActionsFromCitations(assembled.citations),
    citations: assembled.citations,
    relatedQuestions: payload.relatedQuestions,
    matchedCount: assembled.matchedCount,
  };
}

// ── Deep report (streamed) ──────────────────────────────────────

export type DeepReportStreamEvent =
  | { type: "sources"; sources: AskSentinelCitation[] }
  | { type: "progress"; chars: number }
  | { type: "done"; answer: AskSentinelAnswer }
  | { type: "error"; message: string };

/**
 * Generate a deep report as a stream of events. Yields incremental `progress`
 * while the model writes (so the UI shows liveness instead of a frozen 30-60s
 * wait), then a single `done` with the parsed, citation-validated report.
 */
export async function* streamDeepReport(
  query: string,
  ctx: AskContext = {}
): AsyncGenerator<DeepReportStreamEvent> {
  const cleanedQuery = query.trim();
  const history = ctx.history ?? [];
  const answerMode = detectMode(cleanedQuery);

  let assembled: AssembledContext;
  let prompt: string;

  try {
    assembled = ctx.scopes && ctx.scopes.length > 0
      ? await assembleScopedContext(ctx.scopes, cleanedQuery, history, { passages: 8, sourceBudget: 12000 })
      : await assembleGlobalContext(cleanedQuery, history, {
          retrieveLimit: 8,
          citeAll: true,
          fetchCount: 6,
          bodyLen: 3000,
          sourceLen: 10000,
        });

    const profileContext = await getProfileContext();

    prompt = `You are Sentinel, a legal intelligence platform generating an in-depth analytical report. Today's date is ${new Date().toISOString().slice(0, 10)}.

${profileContext ? `USER CONTEXT:\n${profileContext}\n\n` : ""}${transcript(history)}${scopeInstruction(assembled.scopeLabel)}A user has requested a deep report on:
"${cleanedQuery}"

${contextHeading(assembled.scopeLabel)}

${assembled.context}

Generate a comprehensive, structured report:
- 3-5 substantive sections, each covering a different angle, 2-4 paragraphs of content.
- Each section: 2-8 claims with grounding metadata. Set groundingType honestly — use "ai_knowledge" for anything not backed by the records above, never present AI knowledge as sourced fact.
- When a claim is grounded in a specific record, set sourceId to that record's id from the context (the value after "id=").
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
  if (assembled.citations.length > 0) {
    yield { type: "sources", sources: assembled.citations };
  }

  let payload: DeepPayload;
  try {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 6000,
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
    payload = JSON.parse(textOf(final)) as DeepPayload;
  } catch (err) {
    console.error("Ask deep report generation failed:", err);
    yield { type: "error", message: "The report could not be generated." };
    return;
  }

  // Validate cited sourceIds against the records actually in context — drop
  // citations the model invented so the UI never renders a phantom source.
  const sections = (payload.sections || []).map((s) => ({
    ...s,
    claims: (s.claims || []).map((c) =>
      c.sourceId && assembled.validIds.has(c.sourceId) ? c : { ...c, sourceId: undefined, sourceType: undefined }
    ),
  }));

  const allClaims = sections.flatMap((s) => s.claims);
  const groundedClaims = allClaims.filter((c) => c.groundingType !== "ai_knowledge");

  yield {
    type: "done",
    answer: {
      query: cleanedQuery,
      mode: "deep_report",
      answerMode,
      confidence: payload.confidence || "medium",
      summary: payload.summary,
      whyItMatters: payload.whyItMatters,
      actions: payload.actions || [],
      citations: assembled.citations,
      relatedQuestions: payload.relatedQuestions || [],
      matchedCount: assembled.matchedCount,
      reportSections: sections,
      groundingMetrics: {
        totalClaims: allClaims.length,
        groundedClaims: groundedClaims.length,
        groundingRatio: allClaims.length > 0 ? groundedClaims.length / allClaims.length : 0,
      },
    },
  };
}

// ── Shared helpers ──────────────────────────────────────────────

function buildCitations(items: CorpusItem[]): AskSentinelCitation[] {
  return items.map((item) => ({
    id: item.id,
    kind: item.kind,
    title: item.title,
    href: item.href,
    meta: item.meta,
    sourceLabel: item.sourceLabel,
    externalUrl: item.externalUrl,
  }));
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
    if (stored) section += `\nPRIMARY SOURCE DOCUMENT:\n${stored.slice(0, opts.sourceLen)}\n`;
    else if (fetched) section += `\nSOURCE URL CONTENT:\n${fetched.slice(0, opts.sourceLen)}\n`;
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

// ── Context assembly ────────────────────────────────────────────

interface GlobalOpts {
  retrieveLimit: number;
  /** Deep reports cite every retrieved record; quick answers cite the top 4. */
  citeAll: boolean;
  fetchCount: number;
  bodyLen: number;
  sourceLen: number;
}

/** Assemble context by retrieving across the whole corpus (the default path). */
async function assembleGlobalContext(
  query: string,
  history: AskMessage[],
  opts: GlobalOpts
): Promise<AssembledContext> {
  const corpus = await buildCorpus();
  const matches = retrieveCorpus(corpus, retrievalQuery(query, history), opts.retrieveLimit);
  const top = matches.map((m) => m.item);
  const used = opts.citeAll ? top : top.slice(0, 4);

  const sourceContents = await fetchSourceContents(top.slice(0, opts.fetchCount));
  const storedDocs = await getStoredDocTexts(
    top.filter((i) => i.kind === "tracker").map((i) => i.id).slice(0, opts.fetchCount)
  );

  return {
    context: buildContext(used, sourceContents, storedDocs, { bodyLen: opts.bodyLen, sourceLen: opts.sourceLen }),
    citations: buildCitations(used),
    validIds: new Set(used.map((i) => i.id)),
    matchedCount: matches.length,
    hasSourceContent: sourceContents.size > 0 || storedDocs.size > 0,
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
  opts: ScopedOpts
): Promise<AssembledContext> {
  const resolved = await resolveScopes(scopes);
  if (resolved.length === 0) {
    return {
      context: `(The requested source(s) could not be found.)`,
      citations: [],
      validIds: new Set(),
      matchedCount: 0,
      hasSourceContent: false,
      scopeLabel: scopes[0]?.label || "the selected sources",
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

  const scopeLabel =
    resolved.length === 1 ? resolved[0].label : `${resolved.length} selected sources`;

  return {
    context: sections.join("\n\n---\n\n"),
    citations: resolved.map((r) => r.citation),
    validIds: new Set(resolved.map((r) => r.citation.id)),
    matchedCount: resolved.reduce((n, r) => n + r.passages.length, 0),
    hasSourceContent: resolved.some((r) => r.hasFullText),
    scopeLabel,
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

  return `${header}\nRELEVANT PASSAGES FROM THIS SOURCE:\n\n${body}\n`;
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
    : `Most relevant records from Sentinel's tracker, digest, knowledge store, and signals, with any source content fetched from official URLs:`;
}

function fallbackActionsFromCitations(citations: AskSentinelCitation[]): AskSentinelAction[] {
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
  answerMode: AskSentinelAnswer["answerMode"],
  citations: AskSentinelCitation[],
  matchedCount: number
): AskSentinelAnswer {
  return {
    query,
    mode,
    answerMode,
    confidence: "low",
    summary: "Sentinel couldn't complete that request. Please try again.",
    whyItMatters: "",
    actions: [],
    citations,
    relatedQuestions: [],
    matchedCount,
  };
}

function detectMode(query: string): AskSentinelAnswer["answerMode"] {
  const q = query.toLowerCase();
  if (/compare|difference|versus|\bvs\b/.test(q)) return "comparison";
  if (/deadline|deadlines|due|upcoming|when|date/.test(q)) return "deadlines";
  return "briefing";
}

function textOf(message: { content: Array<{ type: string; text?: string }> }): string {
  const block = message.content.find((b) => b.type === "text");
  return block && "text" in block ? (block.text ?? "") : "";
}

// ── Conversational news Q&A (web-grounded, streamed) ─────────────
// News-story scope is a quick, text-message-style chat — not a structured
// briefing. Because web-search citations and json_schema output can't coexist,
// this path is a single unstructured streaming call with web search + fetch,
// so the cited sources are real, checkable links.

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

  let resolved: ScopedSource[];
  let scopeLabel: string;
  let prompt: string;
  try {
    resolved = await resolveScopes(scopes);
    if (resolved.length === 0) {
      yield { type: "error", message: "That story could not be found." };
      return;
    }
    scopeLabel = resolved.length === 1 ? resolved[0].label : `${resolved.length} stories`;

    const perSourceBudget = Math.floor(CONVERSATIONAL_SOURCE_BUDGET / resolved.length);
    const storyBlocks = resolved
      .map((r) => `# ${r.label}\n${sourceBodyText(r, perSourceBudget)}`)
      .join("\n\n---\n\n");

    const profileContext = await getProfileContext();

    prompt = `You are Sentinel, a legal-intelligence assistant. Today's date is ${new Date().toISOString().slice(0, 10)}. The user is asking quick, conversational follow-up questions about a specific news story (or stories). Answer like a knowledgeable colleague over text message: brief, direct, plain language — a sentence or two, a short paragraph at most. No headings, no bullet-point reports (those are for deep reports).

${profileContext ? `USER CONTEXT:\n${profileContext}\n\n` : ""}${transcript(history)}STORY / STORIES IN SCOPE:
${storyBlocks}

The user asks:
"${cleanedQuery}"

Ground your answer in the story text above first. When it doesn't cover the question — or the user asks about developments, reactions, or related context — use web_search / web_fetch to find current, sourced information, and cite what you find. If you're unsure or sources conflict, say so plainly. Keep it conversational and short.${
      history.length > 0 ? "\nThis is a follow-up — treat it in the context of the conversation above." : ""
    }`;
  } catch (err) {
    console.error("Ask conversational setup failed:", err);
    yield { type: "error", message: "Could not assemble the conversation." };
    return;
  }

  try {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 1500,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: WEB_TOOLS as any,
      messages: [{ role: "user", content: prompt }],
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield { type: "delta", text: event.delta.text };
      }
    }

    const final = await stream.finalMessage();
    const content = collectText(final.content as ContentBlockLike[]);
    const citations = extractWebCitations(final.content as ContentBlockLike[], resolved);

    yield {
      type: "done",
      answer: { query: cleanedQuery, content, citations, scopeLabel },
    };
  } catch (err) {
    console.error("Ask conversational generation failed:", err);
    yield { type: "error", message: "Sentinel couldn't answer that. Please try again." };
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
 */
function extractWebCitations(
  blocks: ContentBlockLike[],
  resolved: ScopedSource[]
): AskSentinelCitation[] {
  const out: AskSentinelCitation[] = [];
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
    out.push({
      id: c.url,
      kind: "web",
      title: c.title,
      href: c.url,
      meta: hostOf(c.url),
      sourceLabel: hostOf(c.url),
      externalUrl: c.url,
    });
  }

  return out;
}
