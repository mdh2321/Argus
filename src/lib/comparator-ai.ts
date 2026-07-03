import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/db";
import { entries } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getProfileContext } from "@/lib/profile-context";
import { logAgentRun } from "@/lib/agent-runs";

const client = new Anthropic();
const MODEL = "claude-sonnet-4-6";

export interface ComparisonResult {
  topic: string;
  markdown: string;
  entryIds: string[];
}

// On-demand cross-jurisdiction comparison for a free-text topic (June
// refinement A4). Grounded in the tracker corpus; jurisdictions the tracker
// doesn't cover for the topic are called out as gaps rather than silently
// filled from model knowledge. Output is paste-ready markdown, renderable by
// TopicMarkdown and pinnable to the Shelf as a frozen `comparison` artifact.
export async function generateComparison(topic: string): Promise<ComparisonResult> {
  const allEntries = db
    .select()
    .from(entries)
    .where(eq(entries.archived, false))
    .all();

  const entryContext = allEntries
    .map((e) => {
      const fields = [
        `[${e.id}] ${e.shortName}${e.fullName && e.fullName !== e.shortName ? ` (${e.fullName})` : ""}`,
        `jurisdiction: ${e.jurisdiction} · type: ${e.type} · status: ${e.status} · category: ${e.category}${e.regulator ? ` · regulator: ${e.regulator}` : ""}`,
      ];
      if (e.summary) fields.push(`summary: ${e.summary.slice(0, 350)}`);
      if (e.keyCriteria) fields.push(`key criteria: ${e.keyCriteria.slice(0, 250)}`);
      if (e.penalties) fields.push(`penalties: ${e.penalties.slice(0, 200)}`);
      if (e.keyDates) fields.push(`key dates: ${e.keyDates}`);
      return fields.join("\n  ");
    })
    .join("\n\n");

  const profileContext = await getProfileContext();

  const prompt = `You are a legal intelligence analyst producing a cross-jurisdiction comparison table for an in-house lawyer.

${profileContext ? `USER CONTEXT:\n${profileContext}\n\n` : ""}TOPIC TO COMPARE: "${topic}"

TRACKER CORPUS (${allEntries.length} entries — the user's verified knowledge base):
${entryContext}

Produce a comparison of how each relevant jurisdiction treats this topic. Rules:

1. GROUNDING. Base every claim on the tracker corpus above wherever it covers the topic. Where a jurisdiction in the user's scope has NO relevant tracker entry, either omit it or list it in the gaps line — do NOT fabricate a row from general knowledge. If you include any point from general knowledge rather than the corpus, mark it "(unverified — not in tracker)".
2. STRUCTURE. Output exactly this markdown shape (it is rendered by a strict parser — only ### headings, **bold**, _italics_, bullets with "- ", GFM tables, and paragraphs are supported; no nested markdown inside table cells other than **bold**):

**Cross-jurisdiction comparison — ${topic}**

_One-sentence synthesis of the landscape (≤200 chars)._

| Jurisdiction | <3-6 topic-appropriate columns, e.g. governing instrument & status, key thresholds/requirements, deadlines/dates, penalties> |
|---|---|
| 🇦🇺 AU | … |

### Gaps and caveats

- Jurisdictions in scope with no tracked instrument on this topic, one bullet each.
- Any material caveats (pending bills, consultations closing, transition periods).

### Sources

- One bullet per tracker entry relied on, formatted: **<shortName>** (<jurisdiction>) — entry:<id>

3. COLUMNS. Choose columns that fit the topic (dates, thresholds, penalties, scope). Keep cells tight — fragments, not sentences. Escape any literal pipe characters in cells as \\|.
4. RELEVANCE. Where the user context is provided, orient the comparison to what matters for them (direct obligations or customer pass-through), especially in the synthesis line.

After the markdown, on the very last line, output: ENTRY_IDS: followed by a comma-separated list of the tracker entry ids you relied on (the ids in [brackets] above). Output nothing after that line.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 6000,
    messages: [{ role: "user", content: prompt }],
  });

  let text = (
    response.content[0].type === "text" ? response.content[0].text : ""
  )
    .replace(/^```(?:markdown)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();

  let entryIds: string[] = [];
  const idsMatch = text.match(/\nENTRY_IDS:\s*(.*)\s*$/);
  if (idsMatch) {
    const validIds = new Set(allEntries.map((e) => e.id));
    entryIds = idsMatch[1]
      .split(",")
      .map((s) => s.trim())
      .filter((id) => validIds.has(id));
    text = text.slice(0, idsMatch.index).trim();
  }

  await logAgentRun({
    workflow: "compare",
    modelUsed: MODEL,
    entriesUpdated: 0,
  });

  return { topic, markdown: text, entryIds };
}
