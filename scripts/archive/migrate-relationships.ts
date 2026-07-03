// One-shot migration: backfill authority_level on entries and seed
// entry_relationships from the legacy parent_entry_id + related_entries fields.
//
// Idempotent: safe to re-run. Skips rows already populated.
//
// Run: npx tsx scripts/migrate-relationships.ts
import Database from "better-sqlite3";
import path from "path";
import { ulid } from "ulid";

const dbPath = path.join(process.cwd(), "data", "sentinel.db");
const db = new Database(dbPath);

// ── Authority level backfill ──────────────────────────────────────────────

const TYPE_DEFAULT_AUTHORITY: Record<string, string> = {
  "legislation": "binding",
  "amending-act": "binding",
  "regulation": "binding",
  "binding-guidance": "binding",
  "enforcement": "binding",
  "court-decision": "binding",
  "interpretive-guidance": "expected",
  "policy": "expected",
  "bill": "informational",
  "consultation": "informational",
};

console.log("Backfilling authority_level…");
const rowsNeedingAuthority = db
  .prepare("SELECT id, type FROM entries WHERE authority_level IS NULL OR authority_level = ''")
  .all() as { id: string; type: string }[];

const setAuthority = db.prepare("UPDATE entries SET authority_level = ? WHERE id = ?");
let authorityCount = 0;
for (const row of rowsNeedingAuthority) {
  const level = TYPE_DEFAULT_AUTHORITY[row.type] ?? "informational";
  setAuthority.run(level, row.id);
  authorityCount++;
}
console.log(`  · ${authorityCount} row(s) updated`);

// ── Relationship backfill ─────────────────────────────────────────────────

// Heuristic: figure out the relationship kind from the child's name + type.
// Names are the most reliable signal — types haven't been migrated yet, so a
// "legislation" with "Amendment" / "Reform" / "Tranche" in the name is almost
// always an amending act.
function inferKind(childName: string, childType: string): string {
  if (/\b(amend(ment|ing)?|reform|tranche)\b/i.test(childName)) return "amends";
  switch (childType) {
    case "regulation":
    case "binding-guidance":
      return "subordinate_to";
    case "interpretive-guidance":
    case "policy":
      return "interprets";
    case "bill":
      // Bills with a parent are amendments-in-flight in practice.
      return "amends";
    default:
      return "subordinate_to";
  }
}

console.log("Backfilling entry_relationships from parent_entry_id…");
const childRows = db
  .prepare(
    "SELECT id, short_name, type, parent_entry_id FROM entries WHERE parent_entry_id IS NOT NULL"
  )
  .all() as { id: string; short_name: string; type: string; parent_entry_id: string }[];

const insertRel = db.prepare(
  "INSERT OR IGNORE INTO entry_relationships (id, from_entry_id, to_entry_id, kind, created_at) VALUES (?, ?, ?, ?, ?)"
);

let relInserted = 0;
const inferred: { id: string; name: string; kind: string }[] = [];
for (const row of childRows) {
  const kind = inferKind(row.short_name, row.type);
  const result = insertRel.run(ulid(), row.id, row.parent_entry_id, kind, new Date().toISOString());
  if (result.changes > 0) {
    relInserted++;
    inferred.push({ id: row.id, name: row.short_name, kind });
  }
}
console.log(`  · ${relInserted} parent_entry_id row(s) seeded as relationships`);
for (const r of inferred) {
  console.log(`    - ${r.kind.padEnd(15)} ${r.name}`);
}

// ── related_entries[] (free-form references) ──────────────────────────────

console.log("Backfilling entry_relationships from related_entries[]…");
const relatedRows = db
  .prepare(
    "SELECT id, related_entries FROM entries WHERE related_entries IS NOT NULL AND related_entries != '' AND related_entries != '[]'"
  )
  .all() as { id: string; related_entries: string }[];

let refsInserted = 0;
for (const row of relatedRows) {
  let ids: string[] = [];
  try {
    ids = JSON.parse(row.related_entries);
  } catch {
    console.warn(`  · skipped ${row.id}: malformed related_entries`);
    continue;
  }
  if (!Array.isArray(ids)) continue;
  for (const targetId of ids) {
    if (typeof targetId !== "string" || targetId === row.id) continue;
    const result = insertRel.run(
      ulid(),
      row.id,
      targetId,
      "references",
      new Date().toISOString()
    );
    if (result.changes > 0) refsInserted++;
  }
}
console.log(`  · ${refsInserted} related_entries reference(s) seeded`);

// ── Reclassification candidates (advisory) ────────────────────────────────

console.log("\nReclassification candidates (entries that look like amending acts):");
const legislationRows = db
  .prepare("SELECT id, short_name, type, status FROM entries WHERE archived = 0 AND type = 'legislation'")
  .all() as { id: string; short_name: string; type: string; status: string }[];
const regex = /\b(amend(ment|ing)?|reform|tranche)\b/i;
const list = legislationRows.filter((r) => regex.test(r.short_name));
for (const r of list) {
  console.log(`  · [${r.status.padEnd(15)}] ${r.short_name}  →  consider type='amending-act'`);
}
console.log(`  (${list.length} candidate${list.length === 1 ? "" : "s"} — review manually; not auto-reclassified)`);

console.log("\nDone.");
db.close();
