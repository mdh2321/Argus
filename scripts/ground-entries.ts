// Ground high-impact tracker entries: attach official source documents and
// regenerate summaries so claims/lens cards ground against real docs.
//
// Idempotent and resumable — entries that already have source docs skip the
// suggest/attach step, and entries whose summary_depth is already 'full' skip
// regeneration unless --regen-all is passed.
//
// Usage: npm run ground [-- --min-impact 4] [-- --limit 10] [-- --regen-all] [-- --dry-run]
// Must run with --conditions=react-server (the npm script does) so that
// `server-only` imports in src/lib resolve to the empty stub.

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

const CONCURRENCY = 3;

(async () => {
  const args = process.argv.slice(2);
  const flag = (name: string) => args.includes(name);
  const opt = (name: string, fallback: number) => {
    const i = args.indexOf(name);
    const v = i >= 0 ? parseInt(args[i + 1], 10) : NaN;
    return Number.isFinite(v) ? v : fallback;
  };

  const minImpact = opt("--min-impact", 4);
  const limit = opt("--limit", Infinity);
  const regenAll = flag("--regen-all");
  const dryRun = flag("--dry-run");

  const { db } = await import("../src/db");
  const { entries, sourceDocuments } = await import("../src/db/schema");
  const { eq, and, gte } = await import("drizzle-orm");
  const { suggestSources } = await import("../src/lib/source-suggester");
  const { attachSourcesToEntry } = await import("../src/lib/source-attacher");
  const { runSummaryPipeline } = await import("../src/lib/summary-pipeline");
  const { now } = await import("../src/lib/utils");

  const targets = db
    .select()
    .from(entries)
    .where(and(eq(entries.archived, false), gte(entries.impactScore, minImpact)))
    .all()
    .sort((a, b) => (b.impactScore ?? 0) - (a.impactScore ?? 0))
    .slice(0, Number.isFinite(limit) ? limit : undefined);

  console.log(`[ground] ${targets.length} target entries (impact ≥ ${minImpact})`);

  const docCount = (entryId: string) =>
    db.select({ id: sourceDocuments.id }).from(sourceDocuments).where(eq(sourceDocuments.entryId, entryId)).all().length;

  let attached = 0;
  let regenerated = 0;
  let failures = 0;

  async function groundOne(entry: (typeof targets)[number]) {
    const label = `${entry.shortName} (${entry.jurisdiction}, impact ${entry.impactScore})`;
    try {
      let docsBefore = docCount(entry.id);
      let addedDocs = false;

      // 1. Attach official sources if the entry has none.
      if (docsBefore === 0) {
        console.log(`[ground] ${label}: suggesting sources…`);
        const candidates = await suggestSources({
          shortName: entry.shortName,
          fullName: entry.fullName,
          jurisdiction: entry.jurisdiction,
          type: entry.type,
          regulator: entry.regulator,
          category: entry.category,
          excludeUrls: [],
        });
        // Only auto-attach what a lawyer would accept unseen: official sources.
        const official = candidates
          .filter((c) => c.confidence === "high")
          .slice(0, 2);
        if (official.length === 0) {
          console.warn(`[ground] ${label}: no high-confidence official source found — skipping attach (${candidates.length} candidates, best tier: ${candidates[0]?.tier ?? "none"})`);
        } else if (dryRun) {
          console.log(`[ground] ${label}: would attach ${official.map((c) => c.url).join(", ")}`);
        } else {
          const results = await attachSourcesToEntry(entry.id, official.map((c) => c.url));
          const okDocs = results.filter((r) => r.documentId && r.extracted);
          console.log(`[ground] ${label}: attached ${okDocs.length}/${official.length} (${results.map((r) => `${r.tier}:${r.extracted ? "ok" : r.error ?? "no-text"}`).join(", ")})`);
          if (okDocs.length > 0) {
            attached += okDocs.length;
            addedDocs = true;
          }
        }
        docsBefore = docCount(entry.id);
      }

      // 2. Regenerate the summary when new docs landed or the current
      // analysis isn't a grounded full one.
      const needsRegen = addedDocs || entry.summaryDepth !== "full" || regenAll;
      if (!needsRegen) {
        console.log(`[ground] ${label}: already grounded (${docsBefore} docs, full summary) — skipping`);
        return;
      }
      if (dryRun) {
        console.log(`[ground] ${label}: would regenerate summary (${docsBefore} docs)`);
        return;
      }

      console.log(`[ground] ${label}: regenerating summary (${docsBefore} docs, ${docsBefore > 0 ? "full pipeline" : "preliminary"})…`);
      const t0 = Date.now();
      db.update(entries)
        .set({ summaryStatus: "running", summaryStartedAt: now(), summaryError: null })
        .where(eq(entries.id, entry.id))
        .run();
      await runSummaryPipeline(entry.id);

      const [after] = db.select().from(entries).where(eq(entries.id, entry.id)).all();
      if (after?.summaryStatus === "failed") {
        failures += 1;
        console.error(`[ground] ${label}: summary FAILED — ${after.summaryError}`);
        return;
      }

      // The regeneration is a real review of the entry against its sources.
      db.update(entries)
        .set({ lastReviewed: now() })
        .where(eq(entries.id, entry.id))
        .run();
      regenerated += 1;
      console.log(`[ground] ${label}: done in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
    } catch (err) {
      failures += 1;
      console.error(`[ground] ${label}: ERROR —`, err instanceof Error ? err.message : String(err));
    }
  }

  // Bounded concurrency worker pool.
  const queue = [...targets];
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length > 0) {
      const entry = queue.shift();
      if (!entry) break;
      await groundOne(entry);
    }
  });
  await Promise.all(workers);

  console.log(`\n[ground] done: ${attached} docs attached, ${regenerated} summaries regenerated, ${failures} failures`);
  process.exit(failures > 0 ? 1 : 0);
})();
