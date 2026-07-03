import Database from "better-sqlite3";
import { ulid } from "ulid";
import * as fs from "fs";
import * as path from "path";

const dbPath = path.join(process.cwd(), "data", "sentinel.db");
const dataPath = path.join(process.cwd(), "scripts", "real-data.json");

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

interface EntryData {
  jurisdiction: string;
  category: string;
  type: string;
  status: string;
  shortName: string;
  fullName: string;
  summary?: string;
  whyItMatters?: string;
  complianceImplications?: string;
  penalties?: string;
  maxPenaltyValue?: number;
  maxPenaltyCurrency?: string;
  keyDates?: { date: string; label: string }[];
  impactScore?: number;
  sourceUrls?: string[];
  regulator?: string;
  tags?: string[];
  notes?: string;
  openQuestions?: string;
}

interface IngestEntry {
  action: "create" | "update";
  id?: string;
  data: EntryData;
}

interface IngestPayload {
  entries: IngestEntry[];
  run_metadata?: {
    sources_checked?: string[];
    model_used?: string;
    cost_estimate?: number;
  };
}

function computeNextKeyDate(keyDates: { date: string; label: string }[] | null): string | null {
  if (!keyDates || keyDates.length === 0) return null;
  const today = new Date().toISOString().split("T")[0];
  const future = keyDates
    .filter((kd) => kd.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  return future.length > 0 ? future[0].date : keyDates[keyDates.length - 1].date;
}

function computeUrgency(dateStr: string): string {
  const today = new Date();
  const date = new Date(dateStr);
  const diffDays = Math.floor((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return "overdue";
  if (diffDays <= 30) return "imminent";
  if (diffDays <= 90) return "upcoming";
  return "future";
}

const insertEntry = db.prepare(`
  INSERT INTO entries (
    id, jurisdiction, category, type, status, short_name, full_name,
    summary, why_it_matters, compliance_implications, penalties,
    max_penalty_value, max_penalty_currency, key_dates, next_key_date,
    impact_score, source_urls, regulator, related_entries, tags,
    notes, flagged, open_questions, ai_generated, archived,
    last_reviewed, created_at, updated_at
  ) VALUES (
    ?, ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?,
    ?, ?, ?, ?,
    ?, ?, ?, ?, ?,
    ?, 0, ?, 1, 0,
    ?, ?, ?
  )
`);

const insertDeadline = db.prepare(`
  INSERT INTO deadlines (id, entry_id, date, label, urgency)
  VALUES (?, ?, ?, ?, ?)
`);

const checkDuplicate = db.prepare(`
  SELECT id FROM entries WHERE jurisdiction = ? AND full_name = ?
`);

const updateEntry = db.prepare(`
  UPDATE entries SET
    category = ?, type = ?, status = ?, short_name = ?,
    summary = ?, why_it_matters = ?, compliance_implications = ?,
    penalties = ?, max_penalty_value = ?, max_penalty_currency = ?,
    key_dates = ?, next_key_date = ?, impact_score = ?,
    source_urls = ?, regulator = ?, tags = ?,
    notes = ?, open_questions = ?, updated_at = ?
  WHERE id = ?
`);

const deleteDeadlines = db.prepare(`DELETE FROM deadlines WHERE entry_id = ?`);

const insertUpdateRun = db.prepare(`
  INSERT INTO update_runs (id, run_at, entries_created, entries_updated, sources_checked, model_used, cost_estimate)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

function main() {
  const raw = fs.readFileSync(dataPath, "utf-8");
  const payload: IngestPayload = JSON.parse(raw);
  const timestamp = new Date().toISOString();

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];

  const run = db.transaction(() => {
    for (const item of payload.entries) {
      try {
        const d = item.data;
        const keyDatesJson = d.keyDates ? JSON.stringify(d.keyDates) : null;
        const nextKeyDate = computeNextKeyDate(d.keyDates || null);
        const sourceUrlsJson = d.sourceUrls ? JSON.stringify(d.sourceUrls) : null;
        const tagsJson = d.tags ? JSON.stringify(d.tags) : null;

        // Check for duplicate
        const existing = checkDuplicate.get(d.jurisdiction, d.fullName) as { id: string } | undefined;

        if (existing) {
          // Update existing entry
          updateEntry.run(
            d.category, d.type, d.status, d.shortName,
            d.summary || null, d.whyItMatters || null, d.complianceImplications || null,
            d.penalties || null, d.maxPenaltyValue || null, d.maxPenaltyCurrency || null,
            keyDatesJson, nextKeyDate, d.impactScore || null,
            sourceUrlsJson, d.regulator || null, tagsJson,
            d.notes || null, d.openQuestions || null, timestamp,
            existing.id
          );

          // Re-sync deadlines
          deleteDeadlines.run(existing.id);
          if (d.keyDates) {
            for (const kd of d.keyDates) {
              insertDeadline.run(ulid(), existing.id, kd.date, kd.label, computeUrgency(kd.date));
            }
          }
          updated++;
        } else {
          // Create new entry
          const id = ulid();
          insertEntry.run(
            id, d.jurisdiction, d.category, d.type, d.status, d.shortName, d.fullName,
            d.summary || null, d.whyItMatters || null, d.complianceImplications || null,
            d.penalties || null, d.maxPenaltyValue || null, d.maxPenaltyCurrency || null,
            keyDatesJson, nextKeyDate, d.impactScore || null,
            sourceUrlsJson, d.regulator || null, null, tagsJson,
            d.notes || null, d.openQuestions || null,
            timestamp, timestamp, timestamp
          );

          // Insert deadlines
          if (d.keyDates) {
            for (const kd of d.keyDates) {
              insertDeadline.run(ulid(), id, kd.date, kd.label, computeUrgency(kd.date));
            }
          }
          created++;
        }
      } catch (e) {
        errors.push(`Error: ${item.data.shortName} — ${(e as Error).message}`);
        skipped++;
      }
    }

    // Log the run
    insertUpdateRun.run(
      ulid(),
      timestamp,
      created,
      updated,
      payload.run_metadata?.sources_checked ? JSON.stringify(payload.run_metadata.sources_checked) : null,
      payload.run_metadata?.model_used || null,
      payload.run_metadata?.cost_estimate || null
    );
  });

  run();

  console.log(`\n✓ Ingestion complete`);
  console.log(`  Created: ${created}`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Skipped: ${skipped}`);
  if (errors.length > 0) {
    console.log(`\n  Errors:`);
    errors.forEach((e) => console.log(`    - ${e}`));
  }

  // Summary by jurisdiction
  const summary = db.prepare(`
    SELECT jurisdiction, COUNT(*) as count FROM entries WHERE archived = 0 GROUP BY jurisdiction ORDER BY jurisdiction
  `).all() as { jurisdiction: string; count: number }[];
  console.log(`\n  Entries by jurisdiction:`);
  summary.forEach((r) => console.log(`    ${r.jurisdiction}: ${r.count}`));

  const total = db.prepare(`SELECT COUNT(*) as count FROM entries WHERE archived = 0`).get() as { count: number };
  console.log(`\n  Total entries: ${total.count}`);
}

main();
