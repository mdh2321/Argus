// One-shot migration for the Entry & Source Model plan (July 2026), Phase 1.
//
//   · source_documents.role                — 'primary_text' | 'supporting'
//   · source_document_versions (new table) — compilation history snapshots
//   · backfill role on existing docs        — one primary_text per entry
//
// Backfill heuristic (plan §1.1): a doc is the entry's primary text when it
// carries official_legislation authority OR sits on a primary_legislation URL
// tier AND has usable extracted text. Exactly one primary_text per entry (the
// longest candidate wins on ties); every other doc becomes 'supporting'.
//
// Idempotent: safe to re-run. Skips docs whose role is already set.
//
// Run: npx tsx scripts/migrate-entry-source-model.ts
import Database from "better-sqlite3";
import path from "path";
import { ulid } from "ulid";
import { inferSourceTier } from "../src/lib/source-tiers";

const dbPath = path.join(process.cwd(), "data", "sentinel.db");
const db = new Database(dbPath);

// ── Schema ────────────────────────────────────────────────────────────────

try {
  db.exec("ALTER TABLE source_documents ADD COLUMN role TEXT");
  console.log("· added source_documents.role");
} catch {
  console.log("· source_documents.role already exists");
}

// Satellite delta fields on entries (§2.3).
for (const col of ["what_it_changes", "what_it_clarifies", "outcome"]) {
  try {
    db.exec(`ALTER TABLE entries ADD COLUMN ${col} TEXT`);
    console.log(`· added entries.${col}`);
  } catch {
    console.log(`· entries.${col} already exists`);
  }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS source_document_versions (
    id TEXT PRIMARY KEY,
    source_doc_id TEXT NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
    entry_id TEXT NOT NULL REFERENCES entries(id),
    content_hash TEXT,
    full_text TEXT,
    char_count INTEGER,
    retrieved_at TEXT,
    trigger TEXT NOT NULL DEFAULT 'refresh',
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_source_doc_versions_doc ON source_document_versions(source_doc_id);
  CREATE INDEX IF NOT EXISTS idx_source_doc_versions_entry ON source_document_versions(entry_id);
`);
console.log("· ensured source_document_versions table");

// ── Role backfill ───────────────────────────────────────────────────────────

type DocRow = {
  id: string;
  entry_id: string;
  source_url: string | null;
  full_text: string | null;
  source_authority: string | null;
  role: string | null;
};

const isPrimaryCandidate = (d: DocRow): boolean => {
  if (!d.full_text || d.full_text.length < 200) return false;
  if (d.source_authority === "official_legislation") return true;
  if (d.source_url && inferSourceTier(d.source_url).tier === "primary_legislation") return true;
  return false;
};

const docs = db
  .prepare(
    "SELECT id, entry_id, source_url, full_text, source_authority, role FROM source_documents"
  )
  .all() as DocRow[];

// Group by entry so we can pick exactly one primary text each.
const byEntry = new Map<string, DocRow[]>();
for (const d of docs) {
  const list = byEntry.get(d.entry_id) ?? [];
  list.push(d);
  byEntry.set(d.entry_id, list);
}

const setRole = db.prepare("UPDATE source_documents SET role = ? WHERE id = ?");
let primaryCount = 0;
let supportingCount = 0;

for (const [entryId, entryDocs] of byEntry) {
  // Skip entries whose docs already carry a role (idempotency).
  if (entryDocs.some((d) => d.role)) continue;

  const candidates = entryDocs
    .filter(isPrimaryCandidate)
    .sort((a, b) => (b.full_text?.length ?? 0) - (a.full_text?.length ?? 0));
  const primary = candidates[0];

  for (const d of entryDocs) {
    if (primary && d.id === primary.id) {
      setRole.run("primary_text", d.id);
      primaryCount++;
    } else {
      setRole.run("supporting", d.id);
      supportingCount++;
    }
  }

  if (primary) {
    console.log(`  entry ${entryId}: primary → ${primary.id}`);
  }
}

console.log(
  `\n· ${primaryCount} primary_text, ${supportingCount} supporting across ${byEntry.size} entr${byEntry.size === 1 ? "y" : "ies"}`
);
console.log("Done.");
db.close();
