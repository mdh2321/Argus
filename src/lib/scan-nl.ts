import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { JURISDICTIONS, CATEGORIES } from "@/lib/constants";

const client = new Anthropic();
// Interpretation is a cheap structured classification — Haiku is plenty.
const MODEL = "claude-haiku-4-5-20251001";

const ALL_CODES = JURISDICTIONS.map((j) => j.code);

export interface ScanInterpretation {
  /** Resolved jurisdiction codes. Empty means "the model named no place". */
  jurisdictions: string[];
  /** Optional category filter; empty means no category constraint. */
  categories: string[];
  /** Topical subject to search for, e.g. "electronic signatures". "" = broad audit. */
  focus: string;
  /** Lookback window in days, if the query implied a timeframe. */
  lookbackDays?: number;
  /** One-line human-readable summary of what will be scanned. */
  interpretation: string;
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    jurisdictions: { type: "array", items: { type: "string", enum: ALL_CODES } },
    categories: { type: "array", items: { type: "string", enum: CATEGORIES as unknown as string[] } },
    focus: { type: "string" },
    lookbackDays: { type: "integer" },
    interpretation: { type: "string" },
  },
  required: ["jurisdictions", "categories", "focus", "interpretation"],
} as const;

/**
 * Turn a natural-language scan request ("find e-signature legislation in Asia",
 * "laws in Japan governing spam") into structured scan parameters. Jurisdiction
 * and category values are constrained to the valid sets by the response schema,
 * so the output can be trusted without re-parsing free text.
 */
export async function interpretScanQuery(query: string): Promise<ScanInterpretation> {
  const jurisdictionList = JURISDICTIONS.map((j) => `${j.code} — ${j.name}`).join(", ");

  const prompt = `You convert a user's natural-language request into structured parameters for a regulatory landscape scan across Asia-Pacific jurisdictions.

Valid jurisdictions (code — name): ${jurisdictionList}.
Valid categories: ${CATEGORIES.join(" | ")}.

User request:
"${query}"

Produce:
- jurisdictions: the jurisdiction CODES the request targets. A named country maps to its code. "Asia", "APAC", "the region", "anywhere", or no place mentioned → include ALL of: ${ALL_CODES.join(", ")}. Only include codes from the valid list.
- categories: include a category ONLY when the request clearly maps to one (e.g. e-signatures → "Electronic Signatures & Transactions", spam/marketing messages → "Consumer Protection" or "Privacy & Data Protection"). Otherwise return an empty array.
- focus: a short topical phrase describing the subject to search for, e.g. "electronic signature / e-signature law" or "spam and unsolicited electronic marketing messages". Return an empty string only if the user wants a broad, untargeted audit.
- lookbackDays: derive from any timeframe ("past month" → 30, "past quarter" → 90, "recent" → 180, "this year" → 365). Omit if no timeframe is implied.
- interpretation: one concise sentence describing what will be scanned, e.g. "Scanning Japan for laws governing spam and unsolicited messages."`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 600,
    messages: [{ role: "user", content: prompt }],
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
  });

  const block = response.content.find((b) => b.type === "text");
  const text = block && "text" in block ? block.text ?? "" : "";
  const parsed = JSON.parse(text) as ScanInterpretation;

  // Defensive re-filter even though the schema constrains the enums.
  const validCodes = new Set<string>(ALL_CODES);
  const validCats = new Set<string>(CATEGORIES);

  return {
    jurisdictions: (parsed.jurisdictions || []).filter((c) => validCodes.has(c)),
    categories: (parsed.categories || []).filter((c) => validCats.has(c)),
    focus: (parsed.focus || "").trim(),
    lookbackDays:
      typeof parsed.lookbackDays === "number" && parsed.lookbackDays > 0 ? parsed.lookbackDays : undefined,
    interpretation: parsed.interpretation || "",
  };
}
