// Backfill the dual impact lenses (impact_on_us / impact_on_customers) on
// existing tracker entries. One-off companion to the June 2026 A2 change —
// new/regenerated summaries produce these fields in the pipeline; this fills
// the back catalogue so the Horizon page and entry pages aren't empty.
//
// Usage: npx tsx scripts/backfill-impact-lenses.ts [--dry-run] [--limit N]

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

const BATCH_SIZE = 8;
const MODEL = "claude-sonnet-4-6";

(async () => {
  const dryRun = process.argv.includes("--dry-run");
  const limitIdx = process.argv.indexOf("--limit");
  const limit = limitIdx >= 0 ? parseInt(process.argv[limitIdx + 1], 10) : Infinity;

  const { db } = await import("../src/db");
  const { entries, userProfile } = await import("../src/db/schema");
  const { eq, and, isNull, or } = await import("drizzle-orm");
  const Anthropic = (await import("@anthropic-ai/sdk")).default;

  const client = new Anthropic();

  // Profile block — queried directly rather than via lib/profile-context,
  // which is tagged server-only.
  const [profile] = db.select().from(userProfile).where(eq(userProfile.id, "default")).all();
  const profileBlock = profile
    ? [
        profile.companyName ? `Company: ${profile.companyName}` : null,
        profile.companyDescription ? `Description: ${profile.companyDescription}` : null,
        profile.productsServices ? `Products/Services: ${profile.productsServices}` : null,
        profile.role ? `User role: ${profile.role}` : null,
        profile.freeText ? `Additional context: ${profile.freeText}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  const rows = db
    .select()
    .from(entries)
    .where(
      and(
        eq(entries.archived, false),
        or(isNull(entries.impactOnUs), isNull(entries.impactOnCustomers))
      )
    )
    .all()
    .slice(0, Number.isFinite(limit) ? limit : undefined);

  console.log(`${rows.length} entr${rows.length === 1 ? "y" : "ies"} need impact lenses${dryRun ? " (dry run)" : ""}`);

  let updated = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const entriesBlock = batch
      .map((e) =>
        [
          `### ${e.id}`,
          `Name: ${e.shortName} — ${e.fullName}`,
          `Jurisdiction: ${e.jurisdiction} | Category: ${e.category} | Type: ${e.type} | Status: ${e.status}`,
          e.regulator ? `Regulator: ${e.regulator}` : null,
          e.summary ? `Summary: ${e.summary.slice(0, 700)}` : null,
          e.whyItMatters ? `Business impact notes: ${e.whyItMatters.slice(0, 500)}` : null,
          e.applicability ? `Applicability: ${e.applicability.slice(0, 300)}` : null,
        ]
          .filter(Boolean)
          .join("\n")
      )
      .join("\n\n");

    const prompt = `You are a senior legal intelligence analyst. For each tracked regulatory instrument below, write the two "impact lens" fields for the company described in USER CONTEXT.

USER CONTEXT:
${profileBlock || "(no profile on record — assume an e-signature / agreement-management SaaS vendor serving enterprise customers across APJ)"}

Definitions — impact means effects flowing to the company directly, OR reaching it through its customers; NOT general news significance:
- "impactOnUs": 1-3 plain sentences. How the instrument affects the company DIRECTLY — its own obligations, product features, contracts, or market position. The pre-prepared answer to "what does this mean for us?".
- "impactOnCustomers": 1-3 plain sentences. How it affects the company's CUSTOMERS, including pass-through effects — rules that bind customers (e.g. financial-sector outsourcing rules) and flow down to the company as their vendor. The pre-prepared answer to "what does this mean for our customers?".

Each lens must be specific enough to paste into a Slack message unedited. Use null when a lens genuinely has no effect to report — do not pad.

ENTRIES:
${entriesBlock}

Return ONLY a valid JSON array, one object per entry, preserving the ids:
[{ "id": "<entry id>", "impactOnUs": "<string or null>", "impactOnCustomers": "<string or null>" }]`;

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("");
    const jsonText = text.slice(text.indexOf("["), text.lastIndexOf("]") + 1);

    let results: { id: string; impactOnUs?: string | null; impactOnCustomers?: string | null }[];
    try {
      results = JSON.parse(jsonText);
    } catch (err) {
      console.error(`Batch ${i / BATCH_SIZE + 1}: failed to parse model output, skipping`, err);
      continue;
    }

    for (const r of results) {
      const row = batch.find((e) => e.id === r.id);
      if (!row) {
        console.warn(`  unknown id in response: ${r.id}`);
        continue;
      }
      const updates: Record<string, unknown> = {};
      if (r.impactOnUs && !row.impactOnUs) updates.impactOnUs = r.impactOnUs;
      if (r.impactOnCustomers && !row.impactOnCustomers) updates.impactOnCustomers = r.impactOnCustomers;
      if (Object.keys(updates).length === 0) continue;

      console.log(`  ${row.shortName}`);
      if (updates.impactOnUs) console.log(`    us: ${String(updates.impactOnUs).slice(0, 110)}…`);
      if (updates.impactOnCustomers) console.log(`    customers: ${String(updates.impactOnCustomers).slice(0, 110)}…`);

      if (!dryRun) {
        await db.update(entries).set(updates).where(eq(entries.id, row.id));
        updated++;
      }
    }
  }

  console.log(`Done. ${updated} entr${updated === 1 ? "y" : "ies"} updated.`);
})();
