import type { SourceTier, TrackerSource } from "./types";

const TIER_RULES: { pattern: RegExp; tier: SourceTier }[] = [
  // Primary legislation databases
  { pattern: /legislation\.gov\.au/, tier: "primary_legislation" },
  { pattern: /austlii\.edu\.au/, tier: "primary_legislation" },
  { pattern: /aph\.gov\.au/, tier: "primary_legislation" },
  { pattern: /sso\.agc\.gov\.sg/, tier: "primary_legislation" },
  { pattern: /legislation\.govt\.nz/, tier: "primary_legislation" },
  { pattern: /elegislation\.gov\.hk/, tier: "primary_legislation" },
  { pattern: /japaneselawtranslation\.go\.jp/, tier: "primary_legislation" },
  { pattern: /indiacode\.nic\.in/, tier: "primary_legislation" },
  { pattern: /officialgazette\.gov\.ph/, tier: "primary_legislation" },
  { pattern: /lawphil\.net/, tier: "primary_legislation" },

  // Regulators (specific before generic .gov catch-all)
  { pattern: /acma\.gov\.au/, tier: "regulator" },
  { pattern: /oaic\.gov\.au/, tier: "regulator" },
  { pattern: /austrac\.gov\.au/, tier: "regulator" },
  { pattern: /asic\.gov\.au/, tier: "regulator" },
  { pattern: /apra\.gov\.au/, tier: "regulator" },
  { pattern: /accc\.gov\.au/, tier: "regulator" },
  { pattern: /ag\.gov\.au/, tier: "regulator" },
  { pattern: /homeaffairs\.gov\.au/, tier: "regulator" },
  { pattern: /industry\.gov\.au/, tier: "regulator" },
  { pattern: /minister\.infrastructure\.gov\.au/, tier: "regulator" },
  { pattern: /imda\.gov\.sg/, tier: "regulator" },
  { pattern: /pdpc\.gov\.sg/, tier: "regulator" },
  { pattern: /mas\.gov\.sg/, tier: "regulator" },
  { pattern: /mlaw\.gov\.sg/, tier: "regulator" },
  { pattern: /csa\.gov\.sg/, tier: "regulator" },
  { pattern: /privacy\.org\.nz/, tier: "regulator" },
  { pattern: /pcpd\.org\.hk/, tier: "regulator" },
  { pattern: /hkma\.gov\.hk/, tier: "regulator" },
  { pattern: /ppc\.go\.jp/, tier: "regulator" },
  { pattern: /digital\.go\.jp/, tier: "regulator" },
  { pattern: /meity\.gov\.in/, tier: "regulator" },
  { pattern: /cert-in\.org\.in/, tier: "regulator" },
  { pattern: /privacy\.gov\.ph/, tier: "regulator" },
  // Generic government domains
  { pattern: /\.gov\.(au|sg|nz|hk|in|ph|jp)/, tier: "regulator" },
  { pattern: /\.go\.jp/, tier: "regulator" },

  // Legal commentary (law firms)
  { pattern: /lexology\.com/, tier: "legal_commentary" },
  { pattern: /addisons\.com/, tier: "legal_commentary" },
  { pattern: /ashurst\.com/, tier: "legal_commentary" },
  { pattern: /allens\.com\.au/, tier: "legal_commentary" },
  { pattern: /allenandgledhill\.com/, tier: "legal_commentary" },
  { pattern: /bakermckenzie\.com/, tier: "legal_commentary" },
  { pattern: /cliffordchance\.com/, tier: "legal_commentary" },
  { pattern: /kwm\.com|mallesons\.com/, tier: "legal_commentary" },
  { pattern: /minterellison\.com/, tier: "legal_commentary" },
  { pattern: /herbertsmithfreehills\.com/, tier: "legal_commentary" },
  { pattern: /twobirds\.com/, tier: "legal_commentary" },
  { pattern: /dlapiper\.com/, tier: "legal_commentary" },
  { pattern: /stephensonharwood\.com/, tier: "legal_commentary" },
  { pattern: /roedl\.com/, tier: "legal_commentary" },
  { pattern: /chambers\.com/, tier: "legal_commentary" },
  { pattern: /iclg\.com/, tier: "legal_commentary" },
  { pattern: /mondaq\.com/, tier: "legal_commentary" },

  // Industry bodies & analysis
  { pattern: /iapp\.org/, tier: "industry" },
  { pattern: /mobileecosystemforum\.com/, tier: "industry" },
  { pattern: /aiasiapacific\.org/, tier: "industry" },
  { pattern: /accan\.org\.au/, tier: "industry" },

  // Media
  { pattern: /reuters\.com/, tier: "media" },
  { pattern: /bloomberg\.com/, tier: "media" },
  { pattern: /afr\.com/, tier: "media" },
  { pattern: /straitstimes\.com/, tier: "media" },
  { pattern: /computerweekly\.com/, tier: "media" },
  { pattern: /techcrunch\.com/, tier: "media" },
  { pattern: /zdnet\.com/, tier: "media" },
];

/** Infer the reliability tier for a single URL */
export function inferSourceTier(url: string): TrackerSource {
  let hostname = url;
  try {
    hostname = new URL(url).hostname.replace("www.", "");
  } catch { /* use raw url for matching */ }

  for (const rule of TIER_RULES) {
    if (rule.pattern.test(url) || rule.pattern.test(hostname)) {
      return { url, tier: rule.tier };
    }
  }

  // Default: if it looks like a .gov or .org site, treat as regulator/industry
  if (/\.gov\./.test(hostname)) return { url, tier: "regulator" };
  if (/\.org/.test(hostname)) return { url, tier: "industry" };

  return { url, tier: "media" };
}

/** Infer tiers for an array of URLs */
export function inferSourceTiers(urls: string[]): TrackerSource[] {
  return urls.map(inferSourceTier);
}

/**
 * Upgrade sourceUrls from old string[] format to TrackerSource[].
 * If already TrackerSource[], returns as-is.
 */
export function upgradeSourceUrls(raw: unknown): TrackerSource[] | null {
  if (!raw || !Array.isArray(raw) || raw.length === 0) return null;

  // Check if already in new format
  if (typeof raw[0] === "object" && raw[0] !== null && "tier" in raw[0]) {
    return raw as TrackerSource[];
  }

  // Old format: string[]
  if (typeof raw[0] === "string") {
    return inferSourceTiers(raw as string[]);
  }

  return null;
}

/**
 * Normalize sourceUrls input from API body.
 * Accepts string[], TrackerSource[], or mixed — always returns TrackerSource[].
 */
export function normalizeSourceUrls(input: unknown): TrackerSource[] | null {
  if (!input || !Array.isArray(input) || input.length === 0) return null;
  return upgradeSourceUrls(input);
}
