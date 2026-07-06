import Exa from "exa-js";
import Anthropic from "@anthropic-ai/sdk";
import type { CostGuard } from "./cost-guard";
import { MODELS } from "./config";

export interface SearchHit {
  url: string;
  title: string;
  publishedDate: string | null;
  author: string | null;
  text: string;
  source: "exa" | "anthropic";
  profile?: string; // search profile that surfaced this hit (regulatory_canonical, broad_recent, etc.)
}

export interface SearchAccountant {
  searchCount: number;
  estimatedUsd: number;
}

const EXA_COST_PER_SEARCH = 0.005;

let _client: Exa | null = null;
function client(): Exa {
  if (_client) return _client;
  const key = process.env.EXA_API_KEY;
  if (!key) throw new Error("EXA_API_KEY is not set");
  _client = new Exa(key);
  return _client;
}

export interface ExaSearchParams {
  query: string;
  includeDomains?: string[];
  startPublishedDate: string; // ISO YYYY-MM-DD
  endPublishedDate: string;   // ISO YYYY-MM-DD
  numResults?: number;
}

const MAX_TEXT_CHARS = 8000;

export async function exaSearch(
  params: ExaSearchParams,
  accountant: SearchAccountant
): Promise<SearchHit[]> {
  const numResults = params.numResults ?? 5;
  accountant.searchCount += 1;
  accountant.estimatedUsd += EXA_COST_PER_SEARCH;

  const response = await client().search(params.query, {
    numResults,
    includeDomains: params.includeDomains,
    startPublishedDate: params.startPublishedDate,
    endPublishedDate: params.endPublishedDate,
    type: "auto",
    contents: { text: { maxCharacters: MAX_TEXT_CHARS, includeHtmlTags: false } },
  });

  return (response.results ?? []).map((r) => {
    const maybeText = (r as unknown as { text?: unknown }).text;
    return {
      url: r.url,
      title: r.title ?? "(untitled)",
      publishedDate: r.publishedDate ?? null,
      author: r.author ?? null,
      text: typeof maybeText === "string" ? maybeText : "",
      source: "exa" as const,
    };
  });
}

export function newAccountant(): SearchAccountant {
  return { searchCount: 0, estimatedUsd: 0 };
}

// ─── Anthropic web-search fallback (upgrade plan B2) ─────────────────────────
// Exa is the primary search layer; when a jurisdiction's pool comes back thin
// (Exa error, index gap, sparse week) one Claude call with the web_search
// server tool backfills so coverage doesn't silently degrade.

const anthropic = new Anthropic();

const WEB_SEARCH_COST_PER_USE = 0.01; // $10 / 1000 searches

export interface WebSearchFallbackParams {
  jurisdictionName: string;
  jurisdictionCode: string;
  startDate: string;
  endDate: string;
  topics: readonly string[];
  keyRegulators: string[];
}

export async function anthropicWebSearchFallback(
  p: WebSearchFallbackParams,
  guard: CostGuard
): Promise<SearchHit[]> {
  const prompt = `Search the web for legal and regulatory developments in ${p.jurisdictionName} (${p.jurisdictionCode}) published between ${p.startDate} and ${p.endDate}.

Focus topics: ${p.topics.join("; ")}.
Key regulators: ${p.keyRegulators.join(", ") || "n/a"}.

Prefer primary sources (regulator announcements, court decisions, legislation portals), then legal publications and law firm alerts.

Return ONLY a JSON array of the developments you found, each element:
{
  "url": "full URL",
  "title": "page title",
  "published_date": "YYYY-MM-DD or null",
  "text": "4-6 factual sentences summarising the development from the page content"
}

Only include items actually published within the date window. Return [] if nothing qualifies. No prose outside the JSON.`;

  const response = await anthropic.messages.create({
    model: MODELS.extraction,
    max_tokens: 4000,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
    messages: [{ role: "user", content: prompt }],
  });

  const searchUses = response.content.filter((b) => b.type === "server_tool_use").length;
  guard.addExternal(searchUses * WEB_SEARCH_COST_PER_USE);
  guard.recordAnthropic(MODELS.extraction, {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  });

  let text = "";
  for (let i = response.content.length - 1; i >= 0; i--) {
    const block = response.content[i];
    if (block.type === "text") {
      text = block.text;
      break;
    }
  }

  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter(
      (r): r is { url: string; title?: string; published_date?: string | null; text?: string } =>
        !!r && typeof r === "object" && typeof (r as { url?: unknown }).url === "string"
    )
    .map((r) => ({
      url: r.url,
      title: r.title ?? "(untitled)",
      publishedDate: r.published_date ?? null,
      author: null,
      text: r.text ?? "",
      source: "anthropic" as const,
      profile: "web_search_fallback",
    }));
}
