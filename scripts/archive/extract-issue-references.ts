// Run reference extraction on every story of a single digest issue.
// Usage: npx tsx scripts/extract-issue-references.ts <date>
//   e.g. npx tsx scripts/extract-issue-references.ts 2026-04-20

import fs from "fs";
import path from "path";

// Load env from .env.local before importing anything that touches Anthropic.
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
  const dateArg = process.argv[2];
  if (!dateArg) {
    console.error("Usage: npx tsx scripts/extract-issue-references.ts <date>");
    process.exit(1);
  }

  const { db } = await import("../src/db");
  const { digestIssues, digestStories } = await import("../src/db/schema");
  const { eq } = await import("drizzle-orm");
  const { extractReferencesForStory } = await import(
    "../src/lib/digest-pipeline/extract-references"
  );

  const issue = db
    .select()
    .from(digestIssues)
    .where(eq(digestIssues.date, dateArg))
    .get();

  if (!issue) {
    console.error(`No digest found for date ${dateArg}`);
    process.exit(1);
  }

  const stories = db
    .select({ id: digestStories.id, title: digestStories.title })
    .from(digestStories)
    .where(eq(digestStories.issueId, issue.id))
    .all();

  console.log(`Issue: ${issue.slug} (${stories.length} stories)`);

  let totalRefs = 0;
  let totalMatched = 0;
  let totalUnmatched = 0;

  for (const s of stories) {
    process.stdout.write(`  · ${s.id} … `);
    try {
      const refs = await extractReferencesForStory(s.id);
      const matched = refs.filter((r) => r.status === "matched").length;
      const unmatched = refs.filter((r) => r.status === "unmatched").length;
      totalRefs += refs.length;
      totalMatched += matched;
      totalUnmatched += unmatched;
      console.log(`${refs.length} refs (${matched} matched, ${unmatched} new)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`ERROR: ${msg}`);
    }
  }

  console.log(
    `\nDone. ${totalRefs} references total — ${totalMatched} matched to existing entries, ${totalUnmatched} unmatched.`
  );
})();
