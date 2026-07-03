import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/db";
import { entries, gapSuggestions } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { generateId, now, toJsonString } from "@/lib/utils";
import { getProfileContext } from "@/lib/profile-context";
import { JURISDICTIONS, CATEGORIES, TRACKABLE_ENTRY_TYPES } from "@/lib/constants";
import { serializeGapSuggestion } from "@/lib/gap-ai";
import type { GapSuggestion } from "@/lib/types";

const client = new Anthropic();
const MODEL = "claude-sonnet-4-6";
// Per-jurisdiction web-search budget. Each jurisdiction gets its own call so
// budgets don't have to be shared across the world.
const MAX_WEB_SEARCH_USES_PER_JURISDICTION = 5;

const VALID_JURISDICTIONS = new Set(JURISDICTIONS.map((j) => j.code));
const VALID_CATEGORIES = new Set<string>(CATEGORIES);
const VALID_SUGGESTABLE_TYPES = new Set<string>(TRACKABLE_ENTRY_TYPES);

// Authoritative primary sources per jurisdiction — used to steer the scan
// toward regulator/legislation portals and away from secondary commentary.
const JURISDICTION_SOURCES: Record<string, string[]> = {
  AU: ["legislation.gov.au", "oaic.gov.au", "asic.gov.au", "accc.gov.au", "apra.gov.au"],
  NZ: ["legislation.govt.nz", "privacy.org.nz", "fma.govt.nz", "comcom.govt.nz"],
  SG: ["sso.agc.gov.sg", "pdpc.gov.sg", "mas.gov.sg", "imda.gov.sg"],
  JP: ["japaneselawtranslation.go.jp", "ppc.go.jp", "fsa.go.jp", "meti.go.jp"],
  HK: ["elegislation.gov.hk", "pcpd.org.hk", "sfc.hk", "hkma.gov.hk"],
  IN: ["indiacode.nic.in", "meity.gov.in", "rbi.org.in", "sebi.gov.in"],
  PH: ["officialgazette.gov.ph", "privacy.gov.ph", "bsp.gov.ph", "sec.gov.ph"],
};

type ScanInput = {
  jurisdictions: string[];
  categories?: string[];
  lookbackDays?: number;
  /** Topical subject to narrow the scan to, e.g. "electronic signatures". */
  focus?: string;
};

type ScanResult = {
  suggestions: GapSuggestion[];
  jurisdictionsScanned: string[];
  jurisdictionsFailed: string[];
};

type RawSuggestion = {
  shortName?: string;
  fullName?: string;
  jurisdiction?: string;
  category?: string;
  type?: string;
  regulator?: string;
  rationale?: string;
  sourceUrls?: string[];
};

/**
 * Run a full landscape scan across the requested jurisdictions. Uses Claude
 * web search against authoritative regulator/legislation portals to surface
 * NAMED laws, bills, regulations, and binding guidance that are missing from
 * the tracker.
 *
 * Each jurisdiction gets its own streaming Anthropic call running in parallel,
 * so a long scan in one jurisdiction does not exhaust the search budget or
 * push the request past the SDK's 10-minute non-streaming timeout. Failures
 * in one jurisdiction do not abort the others — pending scan suggestions are
 * only replaced for jurisdictions that successfully scanned.
 */
export async function runLandscapeScan(input: ScanInput): Promise<ScanResult> {
  const jurisdictions = input.jurisdictions
    .map((j) => j.toUpperCase())
    .filter((j) => VALID_JURISDICTIONS.has(j as (typeof JURISDICTIONS)[number]["code"]));

  if (jurisdictions.length === 0) {
    return { suggestions: [], jurisdictionsScanned: [], jurisdictionsFailed: [] };
  }

  const categories =
    input.categories?.filter((c) => VALID_CATEGORIES.has(c)) ?? [];

  const lookbackDays = input.lookbackDays ?? 365;
  const focus = input.focus?.trim() || "";

  const existingEntries = db
    .select({
      shortName: entries.shortName,
      fullName: entries.fullName,
      jurisdiction: entries.jurisdiction,
      regulator: entries.regulator,
    })
    .from(entries)
    .where(and(eq(entries.archived, false), inArray(entries.jurisdiction, jurisdictions)))
    .all();

  const existingByJurisdiction = new Map<string, typeof existingEntries>();
  for (const e of existingEntries) {
    const list = existingByJurisdiction.get(e.jurisdiction) ?? [];
    list.push(e);
    existingByJurisdiction.set(e.jurisdiction, list);
  }

  const profileContext = await getProfileContext();

  // Run one Anthropic call per jurisdiction in parallel. allSettled so a
  // single failure (timeout, parse error, web-search error) doesn't kill the
  // whole scan.
  const settled = await Promise.allSettled(
    jurisdictions.map((j) =>
      scanOneJurisdiction({
        jurisdiction: j,
        existing: existingByJurisdiction.get(j) ?? [],
        categories,
        lookbackDays,
        focus,
        profileContext,
      })
    )
  );

  const successful: { jurisdiction: string; suggestions: RawSuggestion[] }[] = [];
  const failedJurisdictions: string[] = [];

  settled.forEach((res, idx) => {
    const j = jurisdictions[idx];
    if (res.status === "fulfilled") {
      successful.push({ jurisdiction: j, suggestions: res.value });
    } else {
      console.error(`[scan] ${j} failed:`, res.reason);
      failedJurisdictions.push(j);
    }
  });

  if (successful.length === 0) {
    throw new Error(
      `All jurisdiction scans failed (${failedJurisdictions.join(", ")}). Check server logs for details.`
    );
  }

  // Replace pending scan suggestions ONLY for jurisdictions we successfully
  // scanned. Failed jurisdictions keep their previous pending suggestions so
  // a transient error doesn't silently wipe results.
  const successfulCodes = successful.map((s) => s.jurisdiction);
  db.delete(gapSuggestions)
    .where(
      and(
        eq(gapSuggestions.status, "pending"),
        eq(gapSuggestions.source, "scan"),
        inArray(gapSuggestions.suggestedJurisdiction, successfulCodes)
      )
    )
    .run();

  const timestamp = now();
  const created: GapSuggestion[] = [];
  const seen = new Set<string>();
  const existingFingerprints = new Set(
    existingEntries.map(
      (e) => `${e.jurisdiction}|${e.shortName.toLowerCase().trim()}`
    )
  );

  for (const { jurisdiction, suggestions } of successful) {
    for (const sug of suggestions) {
      if (!sug.shortName || !sug.rationale) continue;

      const sugJurisdiction = (sug.jurisdiction || "").toUpperCase();
      if (sugJurisdiction !== jurisdiction) continue;
      if (!sug.category || !VALID_CATEGORIES.has(sug.category)) continue;
      if (categories.length && !categories.includes(sug.category)) continue;

      const type =
        sug.type && VALID_SUGGESTABLE_TYPES.has(sug.type) ? sug.type : null;
      if (!type) continue;

      const fingerprint = `${jurisdiction}|${sug.shortName.toLowerCase().trim()}`;
      if (seen.has(fingerprint) || existingFingerprints.has(fingerprint)) continue;
      seen.add(fingerprint);

      const id = generateId();
      db.insert(gapSuggestions)
        .values({
          id,
          suggestedShortName: sug.shortName.slice(0, 200),
          suggestedFullName: sug.fullName || null,
          suggestedJurisdiction: jurisdiction,
          suggestedCategory: sug.category,
          suggestedType: type,
          suggestedRegulator: sug.regulator || null,
          rationale: sug.rationale.slice(0, 500),
          sourceStoryId: null,
          sourceUrls: toJsonString(
            (sug.sourceUrls || []).filter(
              (u) => typeof u === "string" && u.startsWith("http")
            )
          ),
          source: "scan",
          status: "pending",
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .run();

      const [row] = db
        .select()
        .from(gapSuggestions)
        .where(eq(gapSuggestions.id, id))
        .all();
      if (row) created.push(serializeGapSuggestion(row));
    }
  }

  return {
    suggestions: created,
    jurisdictionsScanned: successfulCodes,
    jurisdictionsFailed: failedJurisdictions,
  };
}

type ScanOneInput = {
  jurisdiction: string;
  existing: { shortName: string; regulator: string | null }[];
  categories: string[];
  lookbackDays: number;
  focus: string;
  profileContext: string;
};

async function scanOneJurisdiction(input: ScanOneInput): Promise<RawSuggestion[]> {
  const { jurisdiction, existing, categories, lookbackDays, focus, profileContext } = input;
  const j_meta = JURISDICTIONS.find((x) => x.code === jurisdiction);
  const sources = JURISDICTION_SOURCES[jurisdiction] || [];

  const existingContext = existing.length
    ? existing
        .map((e) => `- ${e.shortName}${e.regulator ? ` (${e.regulator})` : ""}`)
        .join("\n")
    : "(none — tracker is empty for this jurisdiction)";

  const categoryFilter = categories.length
    ? `Focus ONLY on these categories: ${categories.join(" | ")}.`
    : `Cover all relevant categories: ${CATEGORIES.join(" | ")}.`;

  // A topical focus turns the broad gap-audit into a targeted search: find the
  // named laws on that subject (even longstanding ones) that aren't tracked yet.
  const task = focus
    ? `TASK: Find NAMED laws, bills, regulations, or binding guidance in ${j_meta?.name ?? jurisdiction} specifically about: ${focus}. Use web search against authoritative sources. Longstanding bedrock legislation on this subject IS in scope — include it as long as it is not already in the tracker below.`
    : `TASK: Surface NAMED laws, bills, regulations, or binding guidance that SHOULD be in the tracker but are NOT. Use web search against authoritative sources.`;

  const prompt = `You are a senior legal intelligence analyst ${focus ? `searching for legislation in` : `auditing a regulatory tracker for missing entries in`} ${j_meta?.name ?? jurisdiction} (${jurisdiction}).

${profileContext ? `USER CONTEXT:\n${profileContext}\n\n` : ""}${task}

PREFERRED SOURCES (search these first): ${sources.join(", ")}

${focus ? `SEARCH FOCUS: ${focus}\n\n` : ""}${categoryFilter}

LOOKBACK: prefer items active, in-force, recently amended, or proposed within the last ${lookbackDays} days. Older bedrock legislation is in scope only if it is genuinely missing from the tracker and material.

EXISTING TRACKER ENTRIES for ${jurisdiction} (do NOT re-suggest):
${existingContext}

Search strategy:
1. Run targeted web searches against the preferred primary sources (regulator portals, official legislation sites, gazettes).
2. Identify SPECIFIC, NAMED legal items — e.g. "Privacy Act Amendment Bill 2026", "MAS Notice 626 on AML/CFT", "DPDP Rules 2026". Skip vague topics, generic news stories, or interpretive commentary.
3. Cluster duplicates from different sources into ONE suggestion.
4. For each suggestion, capture an authoritative primary-source URL.
5. Skip anything already in the existing tracker list above.

Rules:
- Only NAMED, canonical legal items (legislation, bills, regulations, binding guidance).
- Court decisions, enforcement actions, and interpretive guidance are NOT trackable subjects — skip them.
- If a candidate's name is fuzzy or you cannot find a primary source, skip it rather than guess.
- Aim for 0–10 suggestions. Quality over quantity.
- Prefer items relevant to the user's profile.

Jurisdiction: ${jurisdiction}
Valid categories: ${CATEGORIES.join(" | ")}
Valid types (must be one of): ${Array.from(VALID_SUGGESTABLE_TYPES).join(", ")}

Respond with ONLY valid JSON, no preamble, no code fences:
{
  "suggestions": [
    {
      "shortName": "DPDP Rules 2026",
      "fullName": "Digital Personal Data Protection Rules 2026",
      "jurisdiction": "${jurisdiction}",
      "category": "Privacy & Data Protection",
      "type": "regulation",
      "regulator": "MeitY",
      "rationale": "One-sentence explanation of why this belongs in the tracker, ideally referencing user profile if known.",
      "sourceUrls": ["https://...primary-source..."]
    }
  ]
}`;

  // Streaming, not create. Web-search calls plus model reasoning routinely
  // exceed the SDK's non-streaming timeout for a multi-search request.
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 4000,
    tools: [
      {
        type: "web_search_20250305",
        name: "web_search",
        max_uses: MAX_WEB_SEARCH_USES_PER_JURISDICTION,
      },
    ],
    messages: [{ role: "user", content: prompt }],
  });

  const response = await stream.finalMessage();
  const text = extractFinalText(response);

  if (!text) {
    throw new Error(`Model returned no text content for ${jurisdiction}`);
  }

  let parsed: { suggestions: RawSuggestion[] };
  try {
    parsed = JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`Model returned non-JSON for ${jurisdiction}`);
    parsed = JSON.parse(match[0]);
  }

  return parsed.suggestions || [];
}

function extractFinalText(response: Anthropic.Messages.Message): string {
  for (let i = response.content.length - 1; i >= 0; i--) {
    const block = response.content[i];
    if (block.type === "text") return block.text;
  }
  return "";
}
