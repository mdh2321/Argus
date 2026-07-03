// Configuration for the weekly digest ingest pipeline.
// First slice: Tier 1 jurisdictions only (AU, SG, JP).
// Tier 2 + extraterritorial scaffolded for later expansion.

export type Tier = "T1" | "T2";

export interface JurisdictionConfig {
  code: string;
  name: string;
  tier: Tier;
  regulatorDomains: string[];
  courtDomains: string[];
  searchBudget: number;
}

export const JURISDICTION_CONFIGS: JurisdictionConfig[] = [
  {
    code: "AU",
    name: "Australia",
    tier: "T1",
    regulatorDomains: [
      "oaic.gov.au",
      "accc.gov.au",
      "asic.gov.au",
      "apra.gov.au",
      "homeaffairs.gov.au",
      "ag.gov.au",
      "industry.gov.au",
    ],
    courtDomains: ["hcourt.gov.au", "fedcourt.gov.au", "austlii.edu.au", "jade.io"],
    searchBudget: 12,
  },
  {
    code: "SG",
    name: "Singapore",
    tier: "T1",
    regulatorDomains: [
      "pdpc.gov.sg",
      "mas.gov.sg",
      "imda.gov.sg",
      "csa.gov.sg",
      "mlaw.gov.sg",
      "aiverify.sg",
      "cpib.gov.sg",
    ],
    courtDomains: ["judiciary.gov.sg", "elitigation.sg", "supremecourt.gov.sg"],
    searchBudget: 12,
  },
  {
    code: "JP",
    name: "Japan",
    tier: "T1",
    regulatorDomains: [
      "ppc.go.jp",
      "meti.go.jp",
      "soumu.go.jp",
      "fsa.go.jp",
      "nisc.go.jp",
      "cao.go.jp",
      "npsc.go.jp",
    ],
    courtDomains: ["courts.go.jp"],
    searchBudget: 12,
  },
  // Tier 2 — defined for future expansion, not searched in the first slice.
  {
    code: "NZ",
    name: "New Zealand",
    tier: "T2",
    regulatorDomains: ["privacy.org.nz", "comcom.govt.nz", "dia.govt.nz", "ncsc.govt.nz"],
    courtDomains: ["courtsofnz.govt.nz", "nzlii.org"],
    searchBudget: 8,
  },
  {
    code: "HK",
    name: "Hong Kong SAR",
    tier: "T2",
    regulatorDomains: ["pcpd.org.hk", "hkma.gov.hk", "sfc.hk", "ogcio.gov.hk"],
    courtDomains: ["legalref.judiciary.hk", "hklii.hk"],
    searchBudget: 8,
  },
  {
    code: "IN",
    name: "India",
    tier: "T2",
    regulatorDomains: [
      "meity.gov.in",
      "rbi.org.in",
      "sebi.gov.in",
      "cci.gov.in",
      "cert-in.org.in",
      "cvc.gov.in",
    ],
    courtDomains: ["main.sci.gov.in", "indiankanoon.org"],
    searchBudget: 8,
  },
  {
    code: "PH",
    name: "Philippines",
    tier: "T2",
    regulatorDomains: ["privacy.gov.ph", "bsp.gov.ph", "dict.gov.ph", "sec.gov.ph"],
    courtDomains: ["sc.judiciary.gov.ph", "lawphil.net"],
    searchBudget: 8,
  },
];

export function getJurisdictionConfig(code: string): JurisdictionConfig | undefined {
  return JURISDICTION_CONFIGS.find((j) => j.code === code);
}

export const TIER_1_CODES = JURISDICTION_CONFIGS.filter((j) => j.tier === "T1").map((j) => j.code);

// Topic taxonomy — used in the extraction prompt so Haiku knows the categories
// to file stories under. We no longer fan out one Exa query per topic; the
// candidate pool inside a domain whitelist is too small for that to differentiate.
// Coverage comes from the search profiles below.
export const SEARCH_TOPICS = [
  "Privacy & Data Protection",
  "Cybersecurity & Data Breach Notification",
  "AI & Emerging Technology",
  "Electronic Signatures & Electronic Transactions",
  "Commercial & Contract Law",
  "Corporate & Governance",
  "Technology & Platform Regulation",
  "Consumer Protection",
  "Employment & Workplace",
  "Intellectual Property",
  "Anti-Corruption, AML & Sanctions",
] as const;

export type SearchTopic = (typeof SEARCH_TOPICS)[number];

// Search profile = a single Exa call for a jurisdiction.
// Multiple profiles per jurisdiction give layered coverage:
// - regulatory_canonical: regulator + court domains, broad regulatory query
// - judicial_canonical:   court domains only, judgment-focused query
// - broad_recent:         no domain restriction — catches law firms, legal publications, news
// - native_language:      per-jurisdiction non-English pass (currently JP only)
export type SearchProfileKind =
  | "regulatory_canonical"
  | "judicial_canonical"
  | "broad_recent"
  | "native_language";

export interface SearchProfile {
  kind: SearchProfileKind;
  buildQuery: (jurisdictionName: string, weekStart: string, weekEnd: string) => string;
  includeDomainsOf: (j: JurisdictionConfig) => string[] | undefined;
  numResults: number;
}

export const SEARCH_PROFILES: SearchProfile[] = [
  {
    kind: "regulatory_canonical",
    buildQuery: (name, ws, we) =>
      `${name} legal regulatory developments published ${ws} to ${we}`,
    includeDomainsOf: (j) => [...j.regulatorDomains, ...j.courtDomains],
    numResults: 8,
  },
  {
    kind: "judicial_canonical",
    buildQuery: (name, ws, we) =>
      `${name} court decision ruling judgment ${ws} to ${we}`,
    includeDomainsOf: (j) => j.courtDomains,
    numResults: 5,
  },
  {
    kind: "broad_recent",
    buildQuery: (name, ws, we) =>
      `${name} technology law regulation enforcement week of ${ws} (through ${we})`,
    includeDomainsOf: () => undefined, // unrestricted — catches law firms, legal publications, broader news
    numResults: 10,
  },
];

// Per-jurisdiction extra profiles (e.g. Japanese-language pass for JP).
export const JURISDICTION_EXTRA_PROFILES: Record<string, SearchProfile[]> = {
  JP: [
    {
      kind: "native_language",
      buildQuery: (_name, ws, we) =>
        `日本 法律 規制 個人情報保護 金融庁 経済産業省 ${ws} ${we}`,
      includeDomainsOf: (j) => [...j.regulatorDomains, ...j.courtDomains],
      numResults: 8,
    },
  ],
};

// Models — match existing Sentinel AI code.
export const MODELS = {
  extraction: "claude-haiku-4-5-20251001",
  synthesis: "claude-sonnet-4-6",
} as const;

// Cost guard
export const COST_BUDGET_USD = 5;

// Targets per tier (story-count threshold for "healthy" coverage).
export const TIER_STORY_TARGETS: Record<Tier, number> = {
  T1: 3,
  T2: 1,
};
