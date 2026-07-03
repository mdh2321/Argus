import Exa from "exa-js";

export interface SearchHit {
  url: string;
  title: string;
  publishedDate: string | null;
  author: string | null;
  text: string;
  source: "exa";
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
