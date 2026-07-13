/**
 * Computed confidence (Phase 2, decision D1): confidence is derived from what
 * actually grounded a claim — grounding type × the cited source's authority
 * tier × quote verification — never self-reported. The model's own assessment
 * may only *downgrade* the computed score, never upgrade it.
 */

import type { AskArgusCitation, AskConfidence, AskGroundingType } from "@/lib/ask-types";

const RANK: Record<AskConfidence, number> = { high: 3, medium: 2, low: 1 };

export function minConfidence(a: AskConfidence, b: AskConfidence): AskConfidence {
  return RANK[a] <= RANK[b] ? a : b;
}

type TierGroup = "primary" | "regulator" | "commentary" | "web";

function tierGroup(tier?: string): TierGroup {
  switch (tier) {
    case "primary_legislation":
      return "primary";
    case "regulator":
      return "regulator";
    case "web":
      return "web";
    default:
      return "commentary"; // legal_commentary, commentary, industry, media, unknown
  }
}

/**
 * The D1 matrix. `quoteVerified` distinguishes a verified direct quote (exact
 * offsets located in stored text) from an unverified one.
 *
 * | grounding ↓ / tier →        | primary | regulator | commentary | web |
 * | direct_quote (verified)     | high    | high      | medium     | medium |
 * | direct_quote (unv.) / para. | high    | medium    | medium     | low |
 * | inference                   | medium  | medium    | low        | low |
 * | ai_knowledge                | low (always)                            |
 */
export function scoreClaimConfidence(
  grounding: AskGroundingType,
  tier: string | undefined,
  quoteVerified: boolean
): AskConfidence {
  if (grounding === "ai_knowledge") return "low";
  const group = tierGroup(tier);

  if (grounding === "direct_quote" && quoteVerified) {
    return group === "primary" || group === "regulator" ? "high" : "medium";
  }
  if (grounding === "direct_quote" || grounding === "paraphrase") {
    if (group === "primary") return "high";
    if (group === "regulator" || group === "commentary") return "medium";
    return "low";
  }
  // inference
  return group === "primary" || group === "regulator" ? "medium" : "low";
}

/** The strongest (highest-tier) citation among those a claim actually cites. */
export function bestCitation(
  sourceIds: string[],
  citationsById: Map<string, AskArgusCitation>
): AskArgusCitation | undefined {
  const order: TierGroup[] = ["primary", "regulator", "commentary", "web"];
  let best: AskArgusCitation | undefined;
  let bestRank = order.length;
  for (const id of sourceIds) {
    const c = citationsById.get(id);
    if (!c) continue;
    const rank = order.indexOf(tierGroup(c.tier));
    if (rank < bestRank) {
      best = c;
      bestRank = rank;
    }
  }
  return best;
}

/**
 * Whole-answer confidence: the weakest load-bearing block (a chain is as
 * strong as its weakest claim). Empty input → medium.
 */
export function overallConfidence(blocks: { confidence: AskConfidence }[]): AskConfidence {
  if (blocks.length === 0) return "medium";
  return blocks.reduce<AskConfidence>((acc, b) => minConfidence(acc, b.confidence), "high");
}
