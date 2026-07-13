// Data normalisation for the two-axis anchor/satellite model (July 2026).
// Idempotent — safe to re-run.
//
//   1. Backfill entries.authority_level from type (Gap 6 depends on it).
//   2. Set entries.parent_entry_id to the PRIMARY parent (amends > subordinate_to
//      > implements > interprets) so multi-parent entries have a canonical
//      nesting parent while the relationship table keeps the rest (Gap 10).
//   3. Disambiguate the overloaded `subordinate_to` link: a principal
//      (`legislation`) entry linked subordinate_to another instrument is a PEER,
//      not delegated legislation — flip it to `references` so it stays its own
//      anchor. Genuine delegated instruments (regulation / *-guidance / policy)
//      keep `subordinate_to`. Every flip is reported.
//   4. Retire superseded predecessors: an entry with an INCOMING `supersedes`
//      from an in-force instrument becomes status=superseded + archived (Gap 1).
//   5. Report likely duplicate instruments by canonical key (Gap 9 detection).
//
// Run: npx tsx scripts/migrate-anchor-model-v2.ts   [--dry]
import Database from "better-sqlite3";
import path from "path";
import { TYPE_DEFAULT_AUTHORITY } from "../src/lib/constants";
import { canonicalInstrumentKey, DELEGATED_KINDS, FOLD_KINDS, INFORMATIVE_KINDS } from "../src/lib/anchor-model";

const DRY = process.argv.includes("--dry");
const dbPath = path.join(process.cwd(), "data", "sentinel.db");
const db = new Database(dbPath);
const nowIso = new Date().toISOString();

type Entry = {
  id: string;
  type: string;
  status: string;
  short_name: string;
  formal_citation: string | null;
  jurisdiction: string | null;
  authority_level: string | null;
  parent_entry_id: string | null;
  archived: number;
};
type Rel = { id: string; from_entry_id: string; to_entry_id: string; kind: string };

const entries = db.prepare("SELECT id,type,status,short_name,formal_citation,jurisdiction,authority_level,parent_entry_id,archived FROM entries").all() as Entry[];
const rels = db.prepare("SELECT id,from_entry_id,to_entry_id,kind FROM entry_relationships").all() as Rel[];
const byId = new Map(entries.map((e) => [e.id, e]));

let authFixed = 0, parentFixed = 0, flipped = 0, retired = 0;

const tx = db.transaction(() => {
  // ── 1. Backfill authority_level ─────────────────────────────────────────
  const setAuth = db.prepare("UPDATE entries SET authority_level=?, updated_at=? WHERE id=?");
  for (const e of entries) {
    if (e.authority_level) continue;
    const auth = TYPE_DEFAULT_AUTHORITY[e.type] ?? "informational";
    e.authority_level = auth;
    if (!DRY) setAuth.run(auth, nowIso, e.id);
    authFixed++;
  }

  // ── 3. Disambiguate subordinate_to (do before parent-pick so kinds are final) ──
  const setKind = db.prepare("UPDATE entry_relationships SET kind=? WHERE id=?");
  const flips: string[] = [];
  for (const r of rels) {
    if (r.kind !== "subordinate_to") continue;
    const child = byId.get(r.from_entry_id);
    const parent = byId.get(r.to_entry_id);
    if (!child || !parent) continue;
    // A principal Act typed `legislation` sitting "under" another instrument is a
    // peer cross-reference, not delegated legislation — genuine delegated
    // instruments are typed regulation / *-guidance / policy.
    if (child.type === "legislation") {
      r.kind = "references";
      if (!DRY) setKind.run("references", r.id);
      flips.push(`  · ${child.short_name}  [${child.type}]  subordinate_to → references  (under ${parent.short_name})`);
      flipped++;
    }
  }

  // ── 2. Set primary parent_entry_id (after kinds finalised) ───────────────
  const PRIORITY = [...FOLD_KINDS, ...DELEGATED_KINDS, ...INFORMATIVE_KINDS]; // amends > subordinate_to/implements > interprets
  const outByFrom = new Map<string, Rel[]>();
  for (const r of rels) outByFrom.set(r.from_entry_id, [...(outByFrom.get(r.from_entry_id) ?? []), r]);
  const setParent = db.prepare("UPDATE entries SET parent_entry_id=?, updated_at=? WHERE id=?");
  for (const e of entries) {
    const outs = outByFrom.get(e.id) ?? [];
    let primary: string | null = null;
    for (const kind of PRIORITY) {
      const hit = outs.find((r) => r.kind === kind);
      if (hit) { primary = hit.to_entry_id; break; }
    }
    // Sync parent to the primary nesting relationship — INCLUDING clearing it
    // when an entry no longer has one (e.g. its only link was flipped to
    // `references`, making it a peer anchor rather than a nested satellite).
    if (e.parent_entry_id !== primary) {
      if (!DRY) setParent.run(primary, nowIso, e.id);
      parentFixed++;
    }
  }

  // ── 4. Retire superseded predecessors ────────────────────────────────────
  const setSuperseded = db.prepare("UPDATE entries SET status='superseded', archived=1, updated_at=? WHERE id=?");
  for (const r of rels) {
    if (r.kind !== "supersedes") continue;
    const successor = byId.get(r.from_entry_id);
    const predecessor = byId.get(r.to_entry_id);
    if (!successor || !predecessor) continue;
    if (successor.status === "in_force" && predecessor.status !== "superseded") {
      if (!DRY) setSuperseded.run(nowIso, predecessor.id);
      retired++;
    }
  }
});
tx();

// ── 5. Duplicate detection (report only) ────────────────────────────────────
const groups = new Map<string, Entry[]>();
for (const e of entries) {
  const key = canonicalInstrumentKey({ formalCitation: e.formal_citation, shortName: e.short_name, jurisdiction: e.jurisdiction });
  if (!key) continue;
  groups.set(key, [...(groups.get(key) ?? []), e]);
}
const dups = [...groups.entries()].filter(([, es]) => es.length > 1);

console.log(`\n${DRY ? "[DRY RUN] " : ""}Anchor-model v2 normalisation`);
console.log(`  authority_level backfilled : ${authFixed}`);
console.log(`  parent_entry_id set        : ${parentFixed}`);
console.log(`  subordinate_to → references: ${flipped}`);
console.log(`  predecessors retired       : ${retired}`);
console.log(`\n  Likely duplicate instruments (canonical key) — ${dups.length} group(s):`);
for (const [key, es] of dups) {
  console.log(`   ▸ "${key}"`);
  for (const e of es) console.log(`       ${e.id}  ${e.short_name}  [${e.type}/${e.status}]`);
}
console.log("");
db.close();
