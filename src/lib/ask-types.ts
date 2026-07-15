export interface AskArgusAction {
  title: string;
  detail: string;
  href?: string;
}

// Which of the three evidence realms a citation draws on (plan §3.3, mirrors
// Legora's three-realm pattern):
//   analysis   — an Argus entry's own analysis fields
//   instrument — a passage of the primary instrument text
//   web        — a live web source
export type CitationRealm = "analysis" | "instrument" | "web";

// The evidentiary pin nested beneath an entry citation (plan §3.1/§3.2): the
// exact passage of the instrument that grounds the claim. Entry-first, pin
// second — never a bare source-doc citation.
export interface AskCitationPin {
  sourceDocumentId: string;
  sectionRef?: string | null;
  quote: string;
  quoteVerified: boolean;
  // Character offsets into the source doc's fullText, when the quote was
  // located verbatim — lets the tracker deep-link highlight the exact range.
  quoteStart?: number | null;
  quoteEnd?: number | null;
}

export interface AskArgusCitation {
  id: string;
  kind: "tracker" | "digest" | "signal" | "knowledge" | "web";
  title: string;
  href: string;
  meta: string;
  sourceLabel: string;
  externalUrl?: string;
  // §3.3 — realm + authority tier for transparency and ordering. Optional so
  // older serialized answers still parse.
  realm?: CitationRealm;
  tier?: string; // e.g. "primary_legislation", "regulator", "commentary", "web"
  // §3.4 — copy-as-citation payload. formalCitation is the entry's lawyer-style
  // citation; pinpoint is the section ref of the pin, if any.
  formalCitation?: string | null;
  // §3.1/§3.2 — the instrument-text evidence pin, when the claim was grounded in
  // the actual instrument rather than only the entry's analysis fields.
  pin?: AskCitationPin | null;
}

/** A single turn in a multi-turn Ask conversation. */
export interface AskMessage {
  role: "user" | "assistant";
  content: string;
}

// ── Web access mode (Phase 3) ───────────────────────────────────
// off  — corpus only (default). on — always run the web research stage.
// auto — corpus first; when grounding is weak the answer *offers* a web
// re-run instead of silently searching.
export type AskWebMode = "off" | "on" | "auto";

// ── Answer trace (Phase 0) ──────────────────────────────────────
// Everything Argus did to assemble an answer, including every degradation
// that used to be silent. Rendered as warning chips + the "How Argus
// answered this" expander, and persisted inside answerJson.

export interface AskTraceSource {
  id: string;
  label: string;
  /** How this source was grounded: stored instrument/doc text, a cached or
   *  live URL fetch, or only the record's own metadata. */
  grounding: "stored_doc" | "cached_fetch" | "live_fetch" | "record_only";
  fetchFailed?: boolean;
}

export interface AskAnswerTrace {
  retrieval: {
    /** fts — normal lexical match; fts_expanded — Haiku query expansion ran;
     *  impact_fallback — no lexical hits, highest-impact records substituted. */
    mode: "fts" | "fts_expanded" | "impact_fallback" | "scoped";
    matched: number;
    considered: number;
  };
  sources: AskTraceSource[];
  /** Requested scopes that could not be resolved (deleted/missing records). */
  scopesDropped: string[];
  webMode: AskWebMode;
  webUsed: boolean;
  webSearches: number;
  /** True when generation hit the output-token cap (answer may be cut short). */
  truncated: boolean;
  /** Human-readable degradation notices — each renders as a warning chip. */
  degraded: string[];
  stages: { name: string; ms: number }[];
  models: { synthesis: string; research?: string };
}

// ── Paragraph-level grounding (Phase 2) ─────────────────────────

export type AskGroundingType = "direct_quote" | "paraphrase" | "inference" | "ai_knowledge";
export type AskConfidence = "high" | "medium" | "low";

export type AskVerificationVerdict =
  | "supported"
  | "partially_supported"
  | "unsupported"
  | "contradicted"
  | "unverifiable";

export interface AskVerification {
  verdict: AskVerificationVerdict;
  reason?: string;
}

/** One paragraph of a quick answer, with its own grounding + citations. */
export interface AskParagraph {
  text: string;
  /** Ids of the context records this paragraph draws on ([] = general knowledge). */
  sourceIds: string[];
  groundingType: AskGroundingType;
  /** Computed from the D1 matrix (grounding × authority tier), never self-reported. */
  confidence: AskConfidence;
  /** Instrument-text pin retrieved with the paragraph's own text as the query. */
  pin?: (AskCitationPin & { entryId: string }) | null;
  /** Present after a "Verify sources" pass. */
  verification?: AskVerification;
}

/**
 * Constrains an Ask conversation to one or more source records (tracked
 * entries, digest stories, knowledge items, signals) instead of the whole
 * corpus. Retrieval then runs over the passages of those documents — the
 * NotebookLM / "ask about this" experience. Sources are picked via `@` mention
 * or the "Add sources" picker, or seeded from an "Ask about this" deep-link.
 */
export interface AskScope {
  kind: "entry" | "story" | "knowledge" | "signal" | "matter";
  id: string;
  /** Human label for the chip; resolved server-side if absent. */
  label?: string;
}

/** A single selectable source returned by the picker / @-mention search. */
export interface AskSourceOption {
  kind: AskScope["kind"];
  id: string;
  title: string;
  meta: string;
  /** Instrument type (entry kind only) — drives the type glyph in the picker. */
  type?: string;
  /** Pre-flight grounding state (entries only): what a scoped ask would
   *  actually read — the instrument text, supporting docs, or summary only. */
  grounding?: "instrument" | "docs" | "record_only";
}

/**
 * A conversational, web-grounded answer for news-story scope — a quick,
 * text-message-style reply rather than the structured briefing card. Produced
 * by a single streaming call with web search + fetch, so the cited sources are
 * real, checkable links.
 */
export interface AskConversationalAnswer {
  query: string;
  sessionId?: string;
  /** Stored message id for this answer — feedback + verification key off it. */
  messageId?: string;
  /** Free-form markdown-ish prose. */
  content: string;
  citations: AskArgusCitation[];
  /** The story (or stories) the conversation is scoped to. */
  scopeLabel?: string;
  trace?: AskAnswerTrace;
}

export interface AskArgusAnswer {
  query: string;
  /** Conversation this answer belongs to. Set by the server on the first turn. */
  sessionId?: string;
  /** Stored message id for this answer — feedback + verification key off it. */
  messageId?: string;
  mode: "quick" | "deep_report";
  /** Legacy field from the old regex mode-detector; optional so old answers parse. */
  answerMode?: "briefing" | "comparison" | "deadlines";
  confidence: AskConfidence;
  summary: string;
  whyItMatters: string;
  actions: AskArgusAction[];
  citations: AskArgusCitation[];
  /** Retrieved but not cited by any paragraph — shown as "Also consulted". */
  alsoConsulted?: AskArgusCitation[];
  relatedQuestions: string[];
  matchedCount: number;
  /** Paragraph blocks with per-paragraph grounding (quick answers, Phase 2).
   *  `summary` remains the joined text for storage/export back-compat. */
  paragraphs?: AskParagraph[];
  /** Auto web mode found weak grounding — offer a one-click web re-run. */
  webSuggested?: boolean;
  trace?: AskAnswerTrace;
  /** Set after a "Verify sources" pass. */
  verifiedAt?: string;
  // Deep report fields (only present when mode === "deep_report")
  reportSections?: DeepReportSection[];
  groundingMetrics?: {
    totalClaims: number;
    groundedClaims: number;
    groundingRatio: number;
  };
}

export interface DeepReportSection {
  heading: string;
  content: string;
  claims: DeepReportClaim[];
}

export interface DeepReportClaim {
  text: string;
  sourceId?: string;
  sourceType?: "tracker" | "digest" | "knowledge" | "signal" | "web";
  groundingType: AskGroundingType;
  confidence: AskConfidence;
  /** Instrument-text pin retrieved with the claim's own text as the query. */
  pin?: (AskCitationPin & { entryId: string }) | null;
  verification?: AskVerification;
}

// ── Feedback (Phase 6) ──────────────────────────────────────────

export type AskFeedbackReason =
  | "wrong_sources"
  | "missed_source"
  | "too_long"
  | "tone"
  | "outdated"
  | "hallucination";

export interface AskFeedbackInput {
  messageId: string;
  sessionId?: string;
  rating: "up" | "down";
  reasons?: AskFeedbackReason[];
  comment?: string;
  query?: string;
}
