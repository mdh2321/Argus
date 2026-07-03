import Database from "better-sqlite3";
import path from "path";

const dbPath = path.join(process.cwd(), "data", "sentinel.db");
const db = new Database(dbPath);

function tableExists(table: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table);
  return !!row;
}

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

console.log("Adding aliases column to entries…");
addMissing("entries", [["aliases", "TEXT"]] as const);

console.log("Migrating existing entries.type = 'guidance' → 'interpretive-guidance'…");
const guidanceMigration = db
  .prepare("UPDATE entries SET type = 'interpretive-guidance' WHERE type = 'guidance'")
  .run();
console.log(`  · ${guidanceMigration.changes} row(s) updated`);

console.log("Creating story_references table…");
if (tableExists("story_references")) {
  console.log("  · story_references already exists");
} else {
  db.exec(`
    CREATE TABLE story_references (
      id TEXT PRIMARY KEY,
      story_id TEXT NOT NULL,
      entry_id TEXT,
      text TEXT NOT NULL,
      char_start INTEGER NOT NULL,
      char_end INTEGER NOT NULL,
      proposed_short_name TEXT,
      proposed_full_name TEXT,
      proposed_jurisdiction TEXT,
      proposed_type TEXT,
      proposed_regulator TEXT,
      proposed_category TEXT,
      parent_proposal TEXT,
      match_confidence REAL,
      status TEXT NOT NULL DEFAULT 'unmatched',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  db.exec(`CREATE INDEX idx_story_references_story_id ON story_references(story_id)`);
  db.exec(`CREATE INDEX idx_story_references_entry_id ON story_references(entry_id)`);
  db.exec(`CREATE INDEX idx_story_references_status ON story_references(status)`);
  console.log("  + story_references (3 indexes)");
}

console.log("Done.");
db.close();
