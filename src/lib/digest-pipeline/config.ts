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
  // CN/ID added Aug 2026. Domains resolved live when added; note CN gov sites
  // serve on www.* with no apex A record, which Exa's domain filter handles
  // (it matches subdomains). npc.gov.cn is the legislature — where draft and
  // passed laws appear before regulators publish implementing measures.
  {
    code: "CN",
    name: "China",
    tier: "T2",
    regulatorDomains: [
      "cac.gov.cn",
      "miit.gov.cn",
      "samr.gov.cn",
      "pbc.gov.cn",
      "nfra.gov.cn",
      "tc260.org.cn",
      "npc.gov.cn",
    ],
    courtDomains: ["court.gov.cn"],
    searchBudget: 8,
  },
  {
    code: "ID",
    name: "Indonesia",
    tier: "T2",
    regulatorDomains: [
      "komdigi.go.id",
      "ojk.go.id",
      "bi.go.id",
      "bssn.go.id",
      "kemenkum.go.id",
      "peraturan.go.id",
    ],
    courtDomains: ["mahkamahagung.go.id", "mkri.id"],
    searchBudget: 8,
  },
];

export function getJurisdictionConfig(code: string): JurisdictionConfig | undefined {
  return JURISDICTION_CONFIGS.find((j) => j.code === code);
}

// Regulator RSS/RDF feeds per jurisdiction (B1 pre-seed layer). RSS is ground
// truth where Exa's date filter drops regulator pages with missing published
// metadata. Every URL here was verified live when added; rss.ts treats each
// feed as best-effort, so a dead feed degrades to a log line, not a failure.
export const RSS_FEEDS: Record<string, string[]> = {
  AU: [
    "https://www.oaic.gov.au/rss",
    "https://www.accc.gov.au/rss/media_releases.xml",
    "https://www.apra.gov.au/rss.xml",
  ],
  JP: [
    "https://www.fsa.go.jp/fsaNewsListAll_rss2.xml",
    "https://www.soumu.go.jp/news.rdf",
  ],
  // SG/NZ/HK/IN/PH regulators surveyed 2026-07 — no stable public feeds found
  // (PDPC/MAS/IMDA/PCPD/MeitY serve HTML at their old feed paths). Add here
  // as they appear.
};

// Key regulators per jurisdiction, by common short name — used in topical
// search queries (B5) so the semantic match lands on regulator output.
export const KEY_REGULATORS: Record<string, string[]> = {
  AU: ["OAIC", "ACCC", "ASIC", "APRA"],
  SG: ["PDPC", "MAS", "IMDA", "CSA"],
  JP: ["PPC", "FSA", "METI"],
  NZ: ["Privacy Commissioner", "Commerce Commission"],
  HK: ["PCPD", "HKMA", "SFC"],
  IN: ["MeitY", "RBI", "CERT-In", "SEBI"],
  PH: ["NPC", "BSP", "DICT"],
  CN: ["CAC", "MIIT", "SAMR", "PBOC"],
  ID: ["Komdigi", "OJK", "BSSN", "Bank Indonesia"],
};

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
// Multiple profiles per jurisdiction give layered topical coverage (B5).
// Queries are date-free — Exa already filters by startPublishedDate/
// endPublishedDate, so dates in the query text were pure noise diluting the
// semantic match. Instead each query is topical and names key regulators.
// - topical_privacy_ai:      privacy / data protection / AI enforcement, official domains
// - topical_esign_commerce:  e-signature / digital trust / contract law, unrestricted
// - topical_cyber_platform:  cyber / platform regulation, unrestricted
// - judicial_canonical:      court domains only, judgment-focused query
// - native_language:         per-jurisdiction non-English pass (JP, CN, ID)
export type SearchProfileKind =
  | "topical_privacy_ai"
  | "topical_esign_commerce"
  | "topical_cyber_platform"
  | "judicial_canonical"
  | "native_language";

export interface SearchProfile {
  kind: SearchProfileKind;
  buildQuery: (jurisdictionName: string, jurisdictionCode: string) => string;
  includeDomainsOf: (j: JurisdictionConfig) => string[] | undefined;
  numResults: number;
}

function regulators(code: string): string {
  return (KEY_REGULATORS[code] ?? []).join(" ");
}

export const SEARCH_PROFILES: SearchProfile[] = [
  {
    kind: "topical_privacy_ai",
    buildQuery: (name, code) =>
      `${name} privacy data protection AI governance regulation enforcement ${regulators(code)}`,
    includeDomainsOf: (j) => [...j.regulatorDomains, ...j.courtDomains],
    numResults: 8,
  },
  {
    kind: "topical_esign_commerce",
    buildQuery: (name) =>
      `${name} electronic signatures electronic transactions digital identity contract law reform`,
    includeDomainsOf: () => undefined, // unrestricted — catches law firms, legal publications, broader news
    numResults: 6,
  },
  {
    kind: "topical_cyber_platform",
    buildQuery: (name, code) =>
      `${name} cybersecurity incident reporting online safety platform regulation ${regulators(code)}`,
    includeDomainsOf: () => undefined,
    numResults: 6,
  },
  {
    kind: "judicial_canonical",
    buildQuery: (name) =>
      `${name} court decision ruling judgment technology privacy data`,
    includeDomainsOf: (j) => j.courtDomains,
    numResults: 5,
  },
];

// Per-jurisdiction extra profiles (e.g. Japanese-language pass for JP).
// Required wherever the regulator publishes primarily in a non-English
// language: the English profiles above semantically miss almost everything on
// ppc.go.jp / cac.gov.cn / komdigi.go.id, because those sites simply have no
// English text to match against.
export const JURISDICTION_EXTRA_PROFILES: Record<string, SearchProfile[]> = {
  JP: [
    {
      kind: "native_language",
      buildQuery: () =>
        `日本 法律 規制 個人情報保護 人工知能 電子署名 個人情報保護委員会 金融庁 経済産業省 総務省`,
      includeDomainsOf: (j) => [...j.regulatorDomains, ...j.courtDomains],
      numResults: 8,
    },
  ],
  CN: [
    {
      kind: "native_language",
      buildQuery: () =>
        `中国 法律 法规 个人信息保护 数据安全 数据出境 人工智能 电子签名 国家网信办 工业和信息化部 市场监管总局`,
      includeDomainsOf: (j) => [...j.regulatorDomains, ...j.courtDomains],
      numResults: 8,
    },
  ],
  ID: [
    {
      kind: "native_language",
      buildQuery: () =>
        `Indonesia peraturan undang-undang pelindungan data pribadi keamanan siber kecerdasan buatan tanda tangan elektronik Komdigi OJK BSSN`,
      includeDomainsOf: (j) => [...j.regulatorDomains, ...j.courtDomains],
      numResults: 8,
    },
  ],
};

// Models — match existing Argus AI code.
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
