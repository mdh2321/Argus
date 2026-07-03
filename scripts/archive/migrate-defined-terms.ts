import Database from "better-sqlite3";
import path from "path";

const dbPath = path.join(process.cwd(), "data", "sentinel.db");
const db = new Database(dbPath);

const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
  .all("defined_terms") as { name: string }[];

if (tables.length > 0) {
  console.log("· defined_terms already exists");
} else {
  db.exec(`
    CREATE TABLE defined_terms (
      id TEXT PRIMARY KEY NOT NULL,
      source_doc_id TEXT NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
      entry_id TEXT NOT NULL REFERENCES entries(id),
      term TEXT NOT NULL,
      definition TEXT NOT NULL,
      section_ref TEXT,
      scope TEXT NOT NULL DEFAULT 'act-wide',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.exec("CREATE INDEX idx_defined_terms_entry_id ON defined_terms (entry_id);");
  db.exec("CREATE INDEX idx_defined_terms_source_doc_id ON defined_terms (source_doc_id);");
  console.log("+ defined_terms table created with indexes");
}

console.log("Done.");
