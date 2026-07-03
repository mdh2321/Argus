// Score an existing entry's impact from its linked digest story.
// Usage: npx tsx scripts/score-entry-from-story.ts <entryId>
//
// Fills impact_score (and optionally summary, whyItMatters) on entries that
// were created before the from-reference route auto-scored.

import fs from "fs";
import path from "path";

const envPath = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

(async () => {
  const entryId = process.argv[2];
  if (!entryId) {
    console.error("Usage: npx tsx scripts/score-entry-from-story.ts <entryId>");
    process.exit(1);
  }

  const { db } = await import("../src/db");
  const { entries, storyReferences, digestStories } = await import(
    "../src/db/schema"
  );
  const { eq } = await import("drizzle-orm");
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const { now } = await import("../src/lib/utils");

  const entry = db.select().from(entries).where(eq(entries.id, entryId)).get();
  if (!entry) {
    console.error(`Entry not found: ${entryId}`);
    process.exit(1);
  }

  const ref = db
    .select()
    .from(storyReferences)
    .where(eq(storyReferences.entryId, entryId))
    .get();
  if (!ref) {
    console.error(`No source story_reference found for entry ${entryId}`);
    process.exit(1);
  }

  const story = db
    .select()
    .from(digestStories)
    .where(eq(digestStories.id, ref.storyId))
    .get();
  if (!story) {
    console.error(`Source story not found: ${ref.storyId}`);
    process.exit(1);
  }

  const anthropic = new Anthropic();

  const prompt = `Score the impact (1-5) of the following tracker entry on Docusign, using ONLY the source story below as ground truth.

TRACKER ENTRY:
- Short name: ${entry.shortName}
- Full name: ${entry.fullName}
- Jurisdiction: ${entry.jurisdiction}
- Type: ${entry.type}
- Category: ${entry.category}

SOURCE STORY:
Title: ${story.title}
${story.url ? `URL: ${story.url}\n` : ""}Summary: ${story.summary}

Impact = effects flowing to Docusign through TWO pathways:
(a) Direct — Docusign is itself legally obligated.
(b) Customer pass-through — a rule binding Docusign's customers (financial services, healthcare, government, legal) materially alters how they use Docusign.

Score:
- 5 (Critical) — direct, imminent, binding obligation OR near-term customer pass-through requiring action.
- 4 (High) — significant, well-defined obligation through (a) or (b); track closely.
- 3 (Moderate) — relevant operating-environment shift; pass-through plausible but speculative; or applicable guidance with no firm deadline.
- 2 (Low) — tangential; affects edge cases or specific deal types only.
- 1 (Minimal) — background context.

Default toward conservative scoring when the source is thin. Global news significance is NOT impact — only effects flowing to Docusign count.

Output JSON only:
{ "impactScore": 3, "rationale": "one sentence explaining the score" }`;

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 400,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const cleaned = text.replace(/```(?:json)?\s*/g, "").replace(/```\s*$/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < 0) {
    console.error("Model did not return JSON:", text);
    process.exit(1);
  }
  const parsed = JSON.parse(cleaned.slice(start, end + 1)) as {
    impactScore?: number;
    rationale?: string;
  };
  const score =
    typeof parsed.impactScore === "number" &&
    parsed.impactScore >= 1 &&
    parsed.impactScore <= 5
      ? Math.round(parsed.impactScore)
      : null;

  if (score === null) {
    console.error("Invalid score:", parsed);
    process.exit(1);
  }

  console.log(`Score: ${score}/5 — ${parsed.rationale ?? ""}`);

  db.update(entries)
    .set({ impactScore: score, updatedAt: now() })
    .where(eq(entries.id, entryId))
    .run();

  console.log(`Updated entry ${entryId}.`);
})();
