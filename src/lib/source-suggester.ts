import Exa from "exa-js";
import { inferSourceTier } from "./source-tiers";
import { JURISDICTION_CONFIGS } from "./digest-pipeline/config";
import type { SourceTier } from "./types";

// Primary legislation registries per jurisdiction. These complement the
// regulator + court domain lists already in digest-pipeline/config.ts.
const LEGISLATION_REGISTRIES: Record<string, string[]> = {
  AU: ["legislation.gov.au", "austlii.edu.au", "aph.gov.au"],
  NZ: ["legislation.govt.nz"],
  SG: ["sso.agc.gov.sg"],
  JP: ["japaneselawtranslation.go.jp", "elaws.e-gov.go.jp"],
  HK: ["elegislation.gov.hk", "hklii.hk"],
  IN: ["indiacode.nic.in"],
  PH: ["officialgazette.gov.ph", "lawphil.net"],
};

export type SourceConfidence = "high" | "medium" | "low";

export interface SourceCandidate {
  url: string;
  hostname: string;
  title: string;
  snippet: string;
  tier: SourceTier;
  confidence: SourceConfidence;
  publishedDate: string | null;
}

export interface SuggesterInput {
  shortName: string;
  fullName: string | null;
  jurisdiction: string;
  type: string;
  regulator: string | null;
  category: string;
  /**
   * Existing source URLs already attached to the entry. Excluded from results
   * so the user isn't shown what they've already approved.
   */
  excludeUrls: string[];
}

let _client: Exa | null = null;
function client(): Exa {
  if (_client) return _client;
  const key = process.env.EXA_API_KEY;
  if (!key) throw new Error("EXA_API_KEY is not set");
  _client = new Exa(key);
  return _client;
}

/**
 * Search official sources for documents that match a tracker entry.
 *
 * Strategy:
 *  - One Exa search restricted to that jurisdiction's known official domains
 *    (legislation registry + regulators + courts).
 *  - Confidence is computed deterministically from the resolved tier — we
 *    never ask the model to score URLs it might not have actually retrieved.
 *  - Results that already exist on the entry are filtered out.
 */
export async function suggestSources(input: SuggesterInput): Promise<SourceCandidate[]> {
  const jurisdictionConfig = JURISDICTION_CONFIGS.find((j) => j.code === input.jurisdiction);
  const jurisdictionName = jurisdictionConfig?.name ?? input.jurisdiction;

  const officialDomains = [
    ...(LEGISLATION_REGISTRIES[input.jurisdiction] ?? []),
    ...(jurisdictionConfig?.regulatorDomains ?? []),
    ...(jurisdictionConfig?.courtDomains ?? []),
  ];

  const query = buildQuery(input, jurisdictionName);

  const exa = client();
  const officialSearch = officialDomains.length > 0
    ? await exa.search(query, {
        numResults: 6,
        includeDomains: officialDomains,
        type: "auto",
        contents: { text: { maxCharacters: 1200, includeHtmlTags: false } },
      })
    : { results: [] as { url: string; title?: string | null; text?: unknown; publishedDate?: string | null }[] };

  // A second pass without domain restriction picks up commentary / industry analysis
  // that the user may want as supplementary sources. Same query, smaller numResults.
  const broadSearch = await exa.search(query, {
    numResults: 4,
    type: "auto",
    contents: { text: { maxCharacters: 800, includeHtmlTags: false } },
  });

  const exclude = new Set(input.excludeUrls.map(normalizeUrl));
  const seen = new Set<string>();
  const candidates: SourceCandidate[] = [];

  for (const r of [...(officialSearch.results ?? []), ...(broadSearch.results ?? [])]) {
    if (!r.url) continue;
    const normalized = normalizeUrl(r.url);
    if (exclude.has(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);

    const text = typeof (r as { text?: unknown }).text === "string"
      ? ((r as { text?: string }).text as string)
      : "";
    const tierInfo = inferSourceTier(r.url);
    candidates.push({
      url: r.url,
      hostname: hostnameOf(r.url),
      title: (r.title ?? "(untitled)").trim(),
      snippet: text.slice(0, 280).replace(/\s+/g, " ").trim(),
      tier: tierInfo.tier,
      confidence: confidenceFromTier(tierInfo.tier),
      publishedDate: r.publishedDate ?? null,
    });
  }

  // Rank: primary_legislation > regulator > legal_commentary > industry > media > model_knowledge
  // (Court domains collapse into 'regulator' under the existing tier rules.)
  const tierRank: Record<SourceTier, number> = {
    primary_legislation: 0,
    regulator: 1,
    legal_commentary: 2,
    industry: 3,
    media: 4,
    model_knowledge: 5,
  };
  candidates.sort((a, b) => tierRank[a.tier] - tierRank[b.tier]);

  return candidates.slice(0, 7);
}

function buildQuery(input: SuggesterInput, jurisdictionName: string): string {
  // Use the most specific identifier we have. Fall back to short name + jurisdiction.
  const name = input.fullName?.trim() || input.shortName.trim();
  const parts = [name, jurisdictionName];
  if (input.regulator) parts.push(input.regulator);
  // Hint that we want the official source rather than commentary.
  parts.push("official text");
  return parts.join(" ");
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return url;
  }
}

function confidenceFromTier(tier: SourceTier): SourceConfidence {
  switch (tier) {
    case "primary_legislation":
    case "regulator":
      return "high";
    case "legal_commentary":
    case "industry":
      return "medium";
    case "media":
    case "model_knowledge":
    default:
      return "low";
  }
}
