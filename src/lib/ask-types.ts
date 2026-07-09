export interface AskArgusAction {
  title: string;
  detail: string;
  href?: string;
}

export interface AskArgusCitation {
  id: string;
  kind: "tracker" | "digest" | "signal" | "knowledge" | "web";
  title: string;
  href: string;
  meta: string;
  sourceLabel: string;
  externalUrl?: string;
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
