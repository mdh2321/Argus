// Re-fetch source documents and detect changes.
// Usage:
//   npx tsx scripts/refresh-sources.ts                    # all sources
//   npx tsx scripts/refresh-sources.ts --max-age-days 7   # only stale (last check > 7d)
//   npx tsx scripts/refresh-sources.ts --entry <entryId>  # one entry's sources

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
  const args = process.argv.slice(2);
  const entryArg = args.indexOf("--entry");
  const maxAgeArg = args.indexOf("--max-age-days");

  const {
    refreshSourcesForEntry,
    refreshStaleSources,
  } = await import("../src/lib/source-refresher");

  const startedAt = Date.now();
  let outcomes;

  if (entryArg >= 0 && args[entryArg + 1]) {
    const entryId = args[entryArg + 1];
    console.log(`Refreshing sources for entry ${entryId}…`);
    outcomes = await refreshSourcesForEntry(entryId);
  } else if (maxAgeArg >= 0 && args[maxAgeArg + 1]) {
    const days = parseInt(args[maxAgeArg + 1], 10);
    if (isNaN(days) || days < 0) {
      console.error("Invalid --max-age-days value");
      process.exit(1);
    }
    console.log(`Refreshing sources not checked in the last ${days} days…`);
    outcomes = await refreshStaleSources(days);
  } else {
    // Default: all sources (max-age = 0 effectively).
    console.log("Refreshing ALL sources (no age filter)…");
    outcomes = await refreshStaleSources(0);
  }

  const summary = {
    total: outcomes.length,
    changed: outcomes.filter((o) => o.status === "changed").length,
    unchanged: outcomes.filter((o) => o.status === "unchanged").length,
    fetch_failed: outcomes.filter((o) => o.status === "fetch_failed").length,
    extraction_failed: outcomes.filter((o) => o.status === "extraction_failed").length,
    no_url: outcomes.filter((o) => o.status === "no_url").length,
  };

  for (const o of outcomes) {
    const flag =
      o.status === "changed"
        ? "✱"
        : o.status === "unchanged"
          ? "·"
          : "✗";
    const note = o.status === "changed" ? " (text changed)" : o.error ? ` (${o.error})` : "";
    console.log(`  ${flag} ${o.url || o.documentId}${note}`);
  }

  console.log(`\nDone in ${((Date.now() - startedAt) / 1000).toFixed(1)}s.`);
  console.log(JSON.stringify(summary, null, 2));
})();
