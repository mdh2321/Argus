import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { getProfileContext } from "@/lib/profile-context";
import { CATEGORIES, ENTRY_TYPES, STATUSES, JURISDICTIONS } from "@/lib/constants";
import type { KeyDate, TrackerSource } from "@/lib/types";
import { normalizeSourceUrls } from "@/lib/source-tiers";

const client = new Anthropic();

const MODEL = "claude-sonnet-4-6";

export interface CapturedDraft {
  jurisdiction: string;
  category: string;
  type: string;
  status: string;
  shortName: string;
  fullName: string;
  summary: string | null;
  whyItMatters: string | null;
  complianceImplications: string | null;
  penalties: string | null;
  impactScore: number | null;
  regulator: string | null;
  sourceUrls: TrackerSource[] | null;
  keyDates: KeyDate[];
  notes: string | null;
  openQuestions: string | null;
  tags: string[];
}

const EXTRACTION_SCHEMA = `{
  "jurisdiction": "<one of: ${JURISDICTIONS.map((j) => j.code).join(", ")}>",
  "category": "<one of: ${CATEGORIES.join(" | ")}>",
  "type": "<one of: ${ENTRY_TYPES.map((t) => t.value).join(" | ")}>",
  "status": "<one of: ${STATUSES.map((s) => s.value).join(" | ")}>",
  "shortName": "<≤80 chars punchy name the team will recognise>",
  "fullName": "<official/full legal name>",
  "summary": "<bullet list, 3-5 bullets on what this is, who it applies to, key provisions. Use • bullets, separate with \\n>",
  "whyItMatters": "<bullet list, 2-4 bullets on practical business impact tailored to the USER CONTEXT if provided>",
  "complianceImplications": "<bullet list, 3-6 bullets on specific obligations>",
  "penalties": "<bullet list of max penalties with amounts/currency, or null>",
  "impactScore": <integer 1-5, 1=minimal, 5=critical>,
  "regulator": "<regulator name e.g. OAIC, MAS, PDPC, or null>",
  "sourceUrls": ["<array of 1-5 authoritative URLs — prefer official gov / regulator sources>"],
  "keyDates": [{"label": "<e.g. Effective date, Consultation deadline>", "date": "<YYYY-MM-DD>"}],
  "notes": "<cross-references, related legislation, or null>",
  "openQuestions": "<bullets on ambiguities or null>",
  "tags": ["<short topical tags>"]
}`;

const FORMATTING_RULES = `FORMATTING RULES:
- For bullet fields: use • character, separate bullets with literal \\n (one line each)
- Separate paragraphs with \\n\\n
- No markdown headers, no **bold**, no inline quotes (use single quotes)
- Return ONLY a single valid JSON object — no prose before/after, no code fences
- If a field is genuinely unknown, return null (except required fields: jurisdiction, category, type, status, shortName, fullName — always fill these)
- Dates must be YYYY-MM-DD`;

function buildSystemPrompt(profileContext: string): string {
  return `You are a senior legal intelligence analyst specialising in Asia-Pacific regulatory frameworks (AU, NZ, SG, JP, HK, IN, PH). You extract structured regulatory entries for a compliance knowledge base.

${profileContext ? `USER CONTEXT:\n${profileContext}\n\n` : ""}Always return ONLY valid JSON matching the schema the user requests. No code fences, no preamble.`;
}

export async function extractFromUrl(url: string): Promise<CapturedDraft> {
  const profileContext = await getProfileContext();

  const prompt = `Extract a regulatory entry from this source URL. Fetch and analyse the page content using web search if needed.

URL: ${url}

${FORMATTING_RULES}

Return JSON matching:
${EXTRACTION_SCHEMA}`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: buildSystemPrompt(profileContext),
    tools: [
      {
        type: "web_search_20250305",
        name: "web_search",
        max_uses: 3,
      },
    ],
    messages: [{ role: "user", content: prompt }],
  });

  const text = extractFinalText(response);
  const draft = parseDraft(text);

  // Ensure source URL is included
  if (!draft.sourceUrls || draft.sourceUrls.length === 0) {
    draft.sourceUrls = normalizeSourceUrls([url]);
  }

  return draft;
}

export async function extractFromDocument(input: {
  name: string;
  text: string;
}): Promise<CapturedDraft> {
  const profileContext = await getProfileContext();
  const truncated = input.text.slice(0, 50000);

  const prompt = `Extract a regulatory entry from this document.

FILE NAME: ${input.name}

DOCUMENT TEXT:
${truncated}

${FORMATTING_RULES}

Return JSON matching:
${EXTRACTION_SCHEMA}`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: buildSystemPrompt(profileContext),
    messages: [{ role: "user", content: prompt }],
  });

  const text = extractFinalText(response);
  return parseDraft(text);
}

export async function searchAndExtract(description: string): Promise<CapturedDraft> {
  const profileContext = await getProfileContext();

  const prompt = `The user described a regulation they want tracked. Use web search to find the most authoritative primary source (government legislation portal, regulator site, official gazette), then extract a structured entry.

USER DESCRIPTION:
${description}

Search strategy:
1. Run targeted web searches to find the legislation/regulation (prefer: legislation.gov.au, oaic.gov.au, sso.agc.gov.sg, pdpc.gov.sg, japaneselawtranslation.go.jp, elegislation.gov.hk, legislation.govt.nz, indiacode.nic.in, officialgazette.gov.ph).
2. If you find an authoritative source, base the entry on it. Include the URL in sourceUrls.
3. If the description is too vague to find anything specific, still return a best-effort draft with a clarifying openQuestions note.

${FORMATTING_RULES}

Return JSON matching:
${EXTRACTION_SCHEMA}`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: buildSystemPrompt(profileContext),
    tools: [
      {
        type: "web_search_20250305",
        name: "web_search",
        max_uses: 5,
      },
    ],
    messages: [{ role: "user", content: prompt }],
  });

  const text = extractFinalText(response);
  return parseDraft(text);
}

function extractFinalText(response: Anthropic.Messages.Message): string {
  // Web-search responses contain tool_use + server_tool_use + text blocks.
  // We want the last assistant text block.
  for (let i = response.content.length - 1; i >= 0; i--) {
    const block = response.content[i];
    if (block.type === "text") return block.text;
  }
  return "";
}

function parseDraft(text: string): CapturedDraft {
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();

  // If the model included prose before the JSON, slice from first { to last }
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace > 0 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  const parsed = robustJsonParse(cleaned);
  return coerceDraft(parsed);
}

function coerceDraft(raw: Record<string, unknown>): CapturedDraft {
  const jurisdiction = typeof raw.jurisdiction === "string" ? raw.jurisdiction.toUpperCase() : "AU";
  const validJurisdiction = JURISDICTIONS.some((j) => j.code === jurisdiction) ? jurisdiction : "AU";

  const category = typeof raw.category === "string" ? raw.category : "";
  const validCategory = (CATEGORIES as readonly string[]).includes(category)
    ? category
    : "Commercial & Contract Law";

  const type = typeof raw.type === "string" ? raw.type : "";
  const validType = ENTRY_TYPES.some((t) => t.value === type) ? type : "legislation";

  const status = typeof raw.status === "string" ? raw.status : "";
  const validStatus = STATUSES.some((s) => s.value === status) ? status : "monitoring";

  const shortName = typeof raw.shortName === "string" && raw.shortName.trim()
    ? raw.shortName.trim()
    : "Captured regulatory item";
  const fullName = typeof raw.fullName === "string" && raw.fullName.trim()
    ? raw.fullName.trim()
    : shortName;

  const rawKeyDates = Array.isArray(raw.keyDates) ? raw.keyDates : [];
  const keyDates: KeyDate[] = [];
  for (const kd of rawKeyDates) {
    if (
      kd &&
      typeof kd === "object" &&
      typeof (kd as KeyDate).date === "string" &&
      typeof (kd as KeyDate).label === "string"
    ) {
      const date = (kd as KeyDate).date;
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        keyDates.push({ label: (kd as KeyDate).label, date });
      }
    }
  }

  const rawUrls = Array.isArray(raw.sourceUrls) ? raw.sourceUrls : [];
  const urlStrings = rawUrls.filter((u): u is string => typeof u === "string" && u.trim().length > 0);
  const sourceUrls = urlStrings.length > 0 ? normalizeSourceUrls(urlStrings) : null;

  const rawTags = Array.isArray(raw.tags) ? raw.tags : [];
  const tags = rawTags.filter((t): t is string => typeof t === "string" && t.trim().length > 0);

  const impactRaw = typeof raw.impactScore === "number" ? raw.impactScore : null;
  const impactScore = impactRaw !== null && impactRaw >= 1 && impactRaw <= 5 ? Math.round(impactRaw) : null;

  return {
    jurisdiction: validJurisdiction,
    category: validCategory,
    type: validType,
    status: validStatus,
    shortName,
    fullName,
    summary: nullableString(raw.summary),
    whyItMatters: nullableString(raw.whyItMatters),
    complianceImplications: nullableString(raw.complianceImplications),
    penalties: nullableString(raw.penalties),
    impactScore,
    regulator: nullableString(raw.regulator),
    sourceUrls,
    keyDates,
    notes: nullableString(raw.notes),
    openQuestions: nullableString(raw.openQuestions),
    tags,
  };
}

function nullableString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function robustJsonParse(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text);
  } catch {
    // Escape raw newlines/tabs inside JSON string values
    let fixed = "";
    let inString = false;
    let escaped = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (escaped) {
        fixed += ch;
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        fixed += ch;
        escaped = true;
        continue;
      }
      if (ch === '"') {
        if (inString) {
          const rest = text.slice(i + 1).trimStart();
          if (
            rest.startsWith(",") ||
            rest.startsWith("}") ||
            rest.startsWith("]") ||
            rest.startsWith(":") ||
            rest.length === 0
          ) {
            inString = false;
            fixed += ch;
          } else {
            fixed += '\\"';
          }
        } else {
          inString = true;
          fixed += ch;
        }
        continue;
      }
      if (inString && ch === "\n") {
        fixed += "\\n";
        continue;
      }
      if (inString && ch === "\r") continue;
      if (inString && ch === "\t") {
        fixed += "\\t";
        continue;
      }
      fixed += ch;
    }
    return JSON.parse(fixed);
  }
}
