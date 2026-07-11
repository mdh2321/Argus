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
  /** Free-form markdown-ish prose. */
  content: string;
  citations: AskArgusCitation[];
  /** The story (or stories) the conversation is scoped to. */
  scopeLabel?: string;
}

export interface AskArgusAnswer {
  query: string;
  /** Conversation this answer belongs to. Set by the server on the first turn. */
  sessionId?: string;
  mode: "quick" | "deep_report";
  answerMode: "briefing" | "comparison" | "deadlines";
  confidence: "high" | "medium" | "low";
  summary: string;
  whyItMatters: string;
  actions: AskArgusAction[];
  citations: AskArgusCitation[];
  relatedQuestions: string[];
  matchedCount: number;
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
  sourceType?: "tracker" | "digest" | "knowledge" | "signal";
  groundingType: "direct_quote" | "paraphrase" | "inference" | "ai_knowledge";
  confidence: "high" | "medium" | "low";
}
