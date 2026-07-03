import Database from "better-sqlite3";
import path from "path";

const dbPath = path.join(process.cwd(), "data", "sentinel.db");
const db = new Database(dbPath);

const additions = [
  ["escalation_triggers", "TEXT"], // JSON: [{trigger, condition, sectionRef}]
  ["compliance_checklist", "TEXT"], // JSON: [{action, owner, evidence, sectionRef}]
  ["threshold_tests", "TEXT"], // JSON: [{question, sectionRef, ifYes, ifNo}]
] as const;

const existing = new Set(
  (db.prepare("PRAGMA table_info(entries)").all() as { name: string }[]).map((r) => r.name)
);

for (const [name, type] of additions) {
  if (existing.has(name)) {
    console.log(`· entries.${name} already exists`);
    continue;
  }
  db.exec(`ALTER TABLE entries ADD COLUMN ${name} ${type}`);
  console.log(`+ entries.${name} ${type}`);
}

console.log("Done.");
