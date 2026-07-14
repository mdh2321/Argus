// Schema migration for the intake-pipeline redesign (July 2026).
// Idempotent — safe to re-run.
//
//   1. entries: add intake_status, intake_error, intake_started_at.
//   2. Create intake_candidates table (per-candidate provenance).
//
// Run: npx tsx scripts/migrate-intake-pipeline.ts
import Database from "better-sqlite3";
import path from "path";

const dbPath = process.env.ARGUS_DB_PATH || path.join(process.cwd(), "data", "sentinel.db");
const db = new Database(dbPath);

function addColumn(table: string, column: string, ddl: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (cols.some((c) => c.name === column)) {
    console.log(`  ✓ ${table}.${column} already exists`);
    return;
  }
  db.prepare(`ALTER TABLE ${table} ADD COLUMN ${ddl}`).run();
  console.log(`  + added ${table}.${column}`);
}

console.log(`Migrating ${dbPath}`);

addColumn("entries", "intake_status", "intake_status TEXT");
addColumn("entries", "intake_error", "intake_error TEXT");
addColumn("entries", "intake_started_at", "intake_started_at TEXT");

db.prepare(
  `CREATE TABLE IF NOT EXISTS intake_candidates (
    id TEXT PRIMARY KEY,
    entry_id TEXT NOT NULL REFERENCES entries(id),
    url TEXT NOT NULL,
    title TEXT,
    snippet TEXT,
    tier TEXT,
    origin TEXT NOT NULL,
    verdict TEXT,
    evidence TEXT,
    suggested_role TEXT,
    status TEXT NOT NULL DEFAULT 'held',
    decided_by TEXT,
    document_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`
).run();
console.log("  ✓ intake_candidates table ensured");

db.prepare(
  `CREATE INDEX IF NOT EXISTS idx_intake_candidates_entry ON intake_candidates(entry_id)`
).run();
console.log("  ✓ idx_intake_candidates_entry ensured");

console.log("Done.");
