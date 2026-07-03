import Database from "better-sqlite3";
import path from "path";

const dbPath = path.join(process.cwd(), "data", "sentinel.db");
const db = new Database(dbPath);

const additions = [["answer_json", "TEXT"]] as const;

function existingColumns(table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

function addMissing(table: string, cols: readonly (readonly [string, string])[]) {
  const existing = existingColumns(table);
  for (const [name, type] of cols) {
    if (existing.has(name)) {
      console.log(`  · ${table}.${name} already exists`);
      continue;
    }
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    console.log(`  + ${table}.${name} ${type}`);
  }
}

console.log("Migrating query_messages…");
addMissing("query_messages", additions);

console.log("Done.");
db.close();
