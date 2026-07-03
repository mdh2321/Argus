import Database from "better-sqlite3";
import path from "path";

const dbPath = path.join(process.cwd(), "data", "sentinel.db");
const db = new Database(dbPath);

const issuesAdditions = [
  ["week_start", "TEXT"],
  ["executive_brief", "TEXT"],
  ["regulatory_radar", "TEXT"],
  ["cross_border_watch", "TEXT"],
  ["compliance_scorecard", "TEXT"],
  ["region_insights", "TEXT"],
  ["coverage_gaps", "TEXT"],
  ["ingest_cost_usd", "REAL"],
  ["ingest_duration_ms", "INTEGER"],
] as const;

const storiesAdditions = [["source_channel", "TEXT"]] as const;

function existingColumns(table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

function addMissing(table: string, additions: readonly (readonly [string, string])[]) {
  const existing = existingColumns(table);
  for (const [name, type] of additions) {
    if (existing.has(name)) {
      console.log(`  · ${table}.${name} already exists`);
      continue;
    }
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    console.log(`  + ${table}.${name} ${type}`);
  }
}

console.log("Migrating digest_issues…");
addMissing("digest_issues", issuesAdditions);
console.log("Migrating digest_stories…");
addMissing("digest_stories", storiesAdditions);

const indexExists = db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
  .get("idx_digest_issues_week_start");
if (!indexExists) {
  db.exec(
    "CREATE UNIQUE INDEX idx_digest_issues_week_start ON digest_issues(week_start) WHERE week_start IS NOT NULL"
  );
  console.log("  + index idx_digest_issues_week_start");
} else {
  console.log("  · index idx_digest_issues_week_start already exists");
}

console.log("Done.");
db.close();
