// End-to-end verification of the two-axis anchor/satellite model and every Part-2
// gap. Runs the REAL executor (applyLifecycleTransition / reverseCommencement)
// against a THROWAWAY COPY of sentinel.db — production is never touched.
//
// Run: npx tsx scripts/verify-anchor-model-v2.ts
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

// Point the app db + skip network refresh BEFORE any module that imports @/db.
const SRC = path.join(process.cwd(), "data", "sentinel.db");
const COPY = path.join(process.env.TMPDIR ?? "/tmp", `verify-anchor-${Date.now()}.db`);
{
  const s = new Database(SRC);
  s.pragma("wal_checkpoint(TRUNCATE)"); // flush WAL so the copy is complete
  s.close();
}
fs.copyFileSync(SRC, COPY);
process.env.ARGUS_DB_PATH = COPY;
process.env.SKIP_SOURCE_REFRESH = "1";

import {
  classifyEntry,
  obligationDisposition,
  resolveLifecycle,
  canonicalInstrumentKey,
} from "../src/lib/anchor-model";

const raw = new Database(COPY);
const ISO = () => new Date().toISOString();

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`  ${cond ? "✅" : "❌"} ${name}${detail ? `  — ${detail}` : ""}`);
  cond ? pass++ : fail++;
}
function section(t: string) { console.log(`\n── ${t} ─────────────────────────────────────────`); }

// Real IDs from the migrated dataset.
const PRIVACY = "01KQNNVJ2QM3E74Q8Q8YD6MVX3"; // Privacy Act 1988 (Cth) — anchor
const TRANCHE1 = "01KMJ9FQSZAQFGTJ4KZ55743AS"; // amends Privacy Act
const CHILDCODE = "01KQF3BWZH8JJY0SFGF05KSM0B"; // binding-guidance, subordinate_to Privacy Act
const CORPS = "01KN3R0Z40KH347H4V2Z1YJNPS"; // AU Corporations Act 2001 — a second anchor

function ent(id: string) {
  return raw.prepare("SELECT id,short_name,status,archived,analysis_stale_reason,summary_depth FROM entries WHERE id=?").get(id) as any;
}
function insertEntry(id: string, shortName: string, type: string, status: string) {
  raw.prepare(
    `INSERT INTO entries (id,jurisdiction,category,type,status,short_name,full_name,summary_status,summary_depth,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(id, "AU", "Privacy & Data Protection", type, status, shortName, shortName, "idle", "full", ISO(), ISO());
}
function insertRel(from: string, to: string, kind: string) {
  raw.prepare("INSERT INTO entry_relationships (id,from_entry_id,to_entry_id,kind,created_at) VALUES (?,?,?,?,?)")
    .run(`rel_${Math.random().toString(36).slice(2)}`, from, to, kind, ISO());
}
function provCount(parentId: string, amendmentId: string) {
  return (raw.prepare("SELECT count(*) n FROM entry_changes WHERE entry_id=? AND old_value=?").get(parentId, amendmentId) as any).n;
}

async function main() {
  const { applyLifecycleTransition, reverseCommencement } = await import("../src/lib/lifecycle");

  // Both anchors need an existing analysis for staleness to apply (the executor
  // deliberately only flags a parent that HAS something to invalidate).
  raw.prepare("UPDATE entries SET summary_depth='full' WHERE id IN (?,?)").run(PRIVACY, CORPS);

  // ── Axis 1 & 2: classification + obligation disposition (Gap 6) ───────────
  section("Two axes — classification & obligation disposition");
  check("amends → satellite", classifyEntry("legislation", ["amends"]) === "satellite");
  check("references → anchor (peer, not buried)", classifyEntry("legislation", ["references"]) === "anchor");
  check("subordinate_to → satellite", classifyEntry("binding-guidance", ["subordinate_to"]) === "satellite");
  check("amends → obligations INHERITED by parent", obligationDisposition("legislation", "binding", ["amends"]) === "inherited");
  check("binding delegated Code → OWN obligations", obligationDisposition("binding-guidance", "binding", ["subordinate_to"]) === "own");
  check("NON-binding guidance made-under → NONE (Gap 6)", obligationDisposition("interpretive-guidance", "interpretive", ["subordinate_to"]) === "none");
  check("peer legislation (references) → OWN", obligationDisposition("legislation", "binding", ["references"]) === "own");

  // ── Pure lifecycle resolver branches ──────────────────────────────────────
  section("resolveLifecycle branches (Gaps 1,2,4,7)");
  const foldPlan = resolveLifecycle("passed", "in_force", [{ kind: "amends", toEntryId: "P" }]);
  check("full commencement → foldInto + archiveSelf", foldPlan.foldInto[0] === "P" && foldPlan.archiveSelf);
  const omni = resolveLifecycle("passed", "in_force", [{ kind: "amends", toEntryId: "A" }, { kind: "amends", toEntryId: "B" }]);
  check("omnibus → folds into ALL targets (Gap 4)", omni.foldInto.length === 2);
  const part = resolveLifecycle("passed", "partially_in_force", [{ kind: "amends", toEntryId: "P" }]);
  check("partial → partialInto, NOT archived (Gap 2)", part.partialInto[0] === "P" && !part.archiveSelf);
  const sup = resolveLifecycle("passed", "in_force", [{ kind: "supersedes", toEntryId: "OLD" }]);
  check("supersede → retire predecessor (Gap 1)", sup.supersede[0] === "OLD" && sup.archiveSelf);
  const lapse = resolveLifecycle("proposed", "lapsed", [{ kind: "amends", toEntryId: "P" }]);
  check("lapse → clearStaleOn + archive (Gap 7)", lapse.clearStaleOn[0] === "P" && lapse.archiveSelf);
  const warn = resolveLifecycle("bill_introduced", "passed", [{ kind: "amends", toEntryId: "P" }]);
  check("passed → early-warning warnStaleOn", warn.warnStaleOn[0] === "P" && !warn.archiveSelf);

  // ── Fold-in on real copy (Gaps 3/5) ───────────────────────────────────────
  section("Fold-in executor — Tranche 1 commences into Privacy Act");
  raw.prepare("UPDATE entries SET status='passed', archived=0 WHERE id=?").run(TRANCHE1);
  raw.prepare("UPDATE entries SET analysis_stale_reason=NULL, summary_depth='full' WHERE id=?").run(PRIVACY);
  raw.prepare("DELETE FROM entry_changes WHERE old_value=?").run(TRANCHE1);
  await applyLifecycleTransition({
    entryId: TRANCHE1, entryShortName: "AU Privacy Act 1988 (Tranche 1 Reforms)",
    entryWhatItChanges: "ADM transparency, statutory tort, children's code power",
    prevStatus: "passed", nextStatus: "in_force", alreadyArchived: false,
  });
  check("amendment archived", ent(TRANCHE1).archived === 1);
  check("parent flagged stale", !!ent(PRIVACY).analysis_stale_reason);
  check("provenance row on parent (old_value=amendment id, Gap 5)", provCount(PRIVACY, TRANCHE1) === 1);

  // ── Reversibility (Gap 8) ─────────────────────────────────────────────────
  section("Reversibility — undo the commencement");
  await reverseCommencement(TRANCHE1);
  check("amendment un-archived + back to passed", ent(TRANCHE1).archived === 0 && ent(TRANCHE1).status === "passed");
  check("parent stale cleared", !ent(PRIVACY).analysis_stale_reason);
  check("provenance row removed", provCount(PRIVACY, TRANCHE1) === 0);

  // ── Omnibus fold-in across many parents (Gap 4) ───────────────────────────
  section("Omnibus — one amendment folds into two anchors");
  const OMNI = "verify_omnibus_1";
  insertEntry(OMNI, "Statute Law Amendment (Omnibus) Act 2026", "amending-act", "passed");
  insertRel(OMNI, PRIVACY, "amends");
  insertRel(OMNI, CORPS, "amends");
  raw.prepare("UPDATE entries SET analysis_stale_reason=NULL WHERE id IN (?,?)").run(PRIVACY, CORPS);
  await applyLifecycleTransition({
    entryId: OMNI, entryShortName: "Statute Law Amendment (Omnibus) Act 2026",
    prevStatus: "passed", nextStatus: "in_force", alreadyArchived: false,
  });
  check("both anchors got provenance rows", provCount(PRIVACY, OMNI) === 1 && provCount(CORPS, OMNI) === 1);
  check("both anchors flagged stale", !!ent(PRIVACY).analysis_stale_reason && !!ent(CORPS).analysis_stale_reason);
  check("omnibus archived", ent(OMNI).archived === 1);

  // ── Supersede / repeal-and-replace (Gap 1) ────────────────────────────────
  section("Supersede — new instrument replaces a predecessor");
  const OLD = "verify_old_act", NEW = "verify_new_act";
  insertEntry(OLD, "Old Widgets Act 1999", "legislation", "in_force");
  insertEntry(NEW, "New Widgets Act 2026", "legislation", "passed");
  insertRel(NEW, OLD, "supersedes");
  await applyLifecycleTransition({
    entryId: NEW, entryShortName: "New Widgets Act 2026",
    prevStatus: "passed", nextStatus: "in_force", alreadyArchived: false,
  });
  check("predecessor retired (status=superseded, archived)", ent(OLD).status === "superseded" && ent(OLD).archived === 1);
  check("supersede provenance row on predecessor", (raw.prepare("SELECT count(*) n FROM entry_changes WHERE entry_id=? AND field_changed='superseded'").get(OLD) as any).n === 1);

  // ── Partial commencement (Gap 2) ──────────────────────────────────────────
  section("Partial commencement — stays live, flags parent");
  const PART = "verify_partial";
  insertEntry(PART, "Staged Reforms Act 2026", "amending-act", "passed");
  insertRel(PART, PRIVACY, "amends");
  raw.prepare("UPDATE entries SET analysis_stale_reason=NULL WHERE id=?").run(PRIVACY);
  await applyLifecycleTransition({
    entryId: PART, entryShortName: "Staged Reforms Act 2026",
    prevStatus: "passed", nextStatus: "partially_in_force", alreadyArchived: false,
  });
  check("amendment NOT archived (still live)", ent(PART).archived === 0);
  check("parent flagged (partial)", (ent(PRIVACY).analysis_stale_reason || "").includes("Partially"));

  // ── Lapse cleanup (Gap 7) ─────────────────────────────────────────────────
  section("Lapse — clears the staleness it imposed");
  const LAPSE = "verify_lapse";
  insertEntry(LAPSE, "Doomed Amendment Bill 2026", "amending-act", "bill_introduced");
  insertRel(LAPSE, CORPS, "amends");
  raw.prepare("UPDATE entries SET analysis_stale_reason=NULL WHERE id=?").run(CORPS);
  await applyLifecycleTransition({ entryId: LAPSE, entryShortName: "Doomed Amendment Bill 2026", prevStatus: "bill_introduced", nextStatus: "passed", alreadyArchived: false });
  const staleAfterPass = !!ent(CORPS).analysis_stale_reason;
  await applyLifecycleTransition({ entryId: LAPSE, entryShortName: "Doomed Amendment Bill 2026", prevStatus: "passed", nextStatus: "lapsed", alreadyArchived: false });
  check("parent went stale on 'passed'", staleAfterPass);
  check("parent stale CLEARED on 'lapsed'", !ent(CORPS).analysis_stale_reason);
  check("lapsed bill archived", ent(LAPSE).archived === 1);

  // ── Duplicate detection (Gap 9) ───────────────────────────────────────────
  section("Duplicate detection — canonical key");
  const k1 = canonicalInstrumentKey({ shortName: "AU Fair Work Act 2009", jurisdiction: "AU" });
  const k2 = canonicalInstrumentKey({ shortName: "Fair Work Act 2009", jurisdiction: "AU" });
  check("same instrument → same key", k1 === k2, k1);
  const k3 = canonicalInstrumentKey({ shortName: "Privacy Act 1988 (Cth)", jurisdiction: "AU" });
  const k4 = canonicalInstrumentKey({ shortName: "Privacy Act 2020", jurisdiction: "NZ" });
  check("different jurisdictions/years → different keys", k3 !== k4, `${k3} vs ${k4}`);

  console.log(`\n════════ ${pass} passed, ${fail} failed ════════\n`);
  raw.close();
  fs.unlinkSync(COPY);
  process.exit(fail === 0 ? 0 : 1);
}

main();
