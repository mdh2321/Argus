import Database from "better-sqlite3";
import { ulid } from "ulid";
import * as fs from "fs";
import * as path from "path";

const dbPath = path.join(process.cwd(), "data", "sentinel.db");
const csvPath = path.join(process.cwd(), "..", "seed-data", "legislation_tracker.csv");

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// RFC 4180-compliant CSV parser
function parseCSV(content: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    const next = content[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++; // skip escaped quote
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field.trim());
        field = "";
      } else if (ch === '\n' || (ch === '\r' && next === '\n')) {
        row.push(field.trim());
        if (row.some(f => f.length > 0)) rows.push(row);
        row = [];
        field = "";
        if (ch === '\r') i++; // skip \n after \r
      } else {
        field += ch;
      }
    }
  }
  // Last field/row
  row.push(field.trim());
  if (row.some(f => f.length > 0)) rows.push(row);

  const headers = rows[0];
  console.log("CSV headers:", headers);
  console.log("First data row fields:", rows[1].length);

  return rows.slice(1).map((dataRow) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = dataRow[i] || "";
    });
    return obj;
  });
}

function mapJurisdiction(country: string): string {
  const map: Record<string, string> = {
    australia: "AU", singapore: "SG", japan: "JP",
    "new zealand": "NZ", "hong kong": "HK", india: "IN", philippines: "PH",
  };
  return map[country.toLowerCase().trim()] || country;
}

function mapCategory(cat: string): string {
  const map: Record<string, string> = {
    "data privacy": "Privacy & Data Protection",
    "electronic signatures": "Electronic Signatures & Transactions",
    "cybersecurity": "Data Security & Breach Notification",
    "ai/technology": "AI & Emerging Technology",
    "cybersecurity/criminal": "Data Security & Breach Notification",
  };
  return map[cat.toLowerCase().trim()] || cat;
}

function mapStatus(status: string): string {
  const s = status.toLowerCase().trim();
  if (s.includes("active")) return "in_force";
  if (s.includes("pending")) return "passed";
  if (s.includes("proposed")) return "proposed";
  if (s.includes("upcoming")) return "passed";
  return "in_force";
}

function mapImpact(relevance: string): number {
  const r = relevance.toLowerCase();
  if (r.startsWith("critical")) return 5;
  if (r.startsWith("high")) return 4;
  if (r.startsWith("medium-high")) return 4;
  if (r.startsWith("medium")) return 3;
  if (r.startsWith("low-medium")) return 2;
  if (r.startsWith("low")) return 2;
  return 3;
}

function mapType(category: string, status: string): string {
  const cat = category.toLowerCase();
  const s = status.toLowerCase();
  if (s.includes("proposed")) return "bill";
  if (cat.includes("ai") && s.includes("voluntary")) return "guidance";
  return "legislation";
}

function parseKeyDates(effectiveDate: string, complianceDeadline: string): { date: string; label: string }[] {
  const dates: { date: string; label: string }[] = [];
  const dateRegex = /(\w+ \d{1,2},?\s*\d{4}|\d{4}-\d{2}-\d{2})/;

  const tryParse = (str: string, label: string) => {
    if (!str || str === "Ongoing" || str === "TBD" || str.startsWith("Various")) return;
    const match = str.match(dateRegex);
    if (match) {
      const parsed = new Date(match[1]);
      if (!isNaN(parsed.getTime())) {
        dates.push({ date: parsed.toISOString().split("T")[0], label });
      }
    }
  };

  tryParse(effectiveDate, "Effective date");
  tryParse(complianceDeadline, "Compliance deadline");
  return dates;
}

// Clear existing data first
db.exec("DELETE FROM deadlines");
db.exec("DELETE FROM entry_changes");
db.exec("DELETE FROM entries");
console.log("Cleared existing data");

const csvContent = fs.readFileSync(csvPath, "utf-8");
const rows = parseCSV(csvContent);
console.log(`Parsed ${rows.length} entries from CSV\n`);

// Debug first row
const first = rows[0];
console.log("Sample entry:");
console.log("  Country:", first["Country"]);
console.log("  Legislation:", first["Legislation/Regulation"]);
console.log("  Category:", first["Category"]);
console.log("  Penalties:", first["Penalties"]);
console.log("  Regulatory Body:", first["Regulatory Body"]);
console.log("  Relevance:", first["Relevance to Tech Companies (DocuSign)"]?.substring(0, 80));
console.log("");

const insert = db.prepare(`
  INSERT INTO entries (
    id, jurisdiction, category, type, status, short_name, full_name,
    summary, why_it_matters, compliance_implications, penalties,
    impact_score, source_urls, regulator, notes, key_dates, next_key_date,
    flagged, ai_generated, archived, last_reviewed, created_at, updated_at
  ) VALUES (
    ?, ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?,
    ?, ?, ?, ?, ?, ?,
    0, 0, 0, ?, ?, ?
  )
`);

const insertDeadline = db.prepare(`
  INSERT INTO deadlines (id, entry_id, date, label, urgency)
  VALUES (?, ?, ?, ?, ?)
`);

const now = new Date().toISOString();
let count = 0;

for (const row of rows) {
  const jurisdiction = mapJurisdiction(row["Country"]);
  const fullName = row["Legislation/Regulation"];
  const category = mapCategory(row["Category"]);
  const status = mapStatus(row["Status"]);
  const type = mapType(row["Category"], row["Status"]);

  const relevance = row["Relevance to Tech Companies (DocuSign)"] || "";
  const impact = mapImpact(relevance);

  const shortName = `${jurisdiction} ${fullName.length > 55 ? fullName.substring(0, 52) + "..." : fullName}`;

  const keyReqs = row["Key Requirements"] || "";
  const penalties = row["Penalties"] || "";
  const regulator = row["Regulatory Body"] || "";
  const notes = row["Notes/Updates"] || "";
  const source = row["Source"] || "";

  const keyDates = parseKeyDates(row["Effective Date"] || "", row["Compliance Deadline"] || "");
  const keyDatesJson = keyDates.length > 0 ? JSON.stringify(keyDates) : null;

  const today = new Date().toISOString().split("T")[0];
  const futureDates = keyDates.filter((kd) => kd.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const nextKeyDate = futureDates.length > 0 ? futureDates[0].date : null;

  const sourceUrls = source ? JSON.stringify([source]) : null;
  const id = ulid();

  try {
    insert.run(
      id, jurisdiction, category, type, status, shortName, fullName,
      keyReqs,       // summary
      relevance,     // why_it_matters
      null,          // compliance_implications
      penalties,     // penalties
      impact, sourceUrls, regulator, notes, keyDatesJson, nextKeyDate,
      now, now, now
    );

    for (const kd of keyDates) {
      const diffDays = Math.floor((new Date(kd.date).getTime() - Date.now()) / 86400000);
      let urgency = "future";
      if (diffDays < 0) urgency = "overdue";
      else if (diffDays <= 30) urgency = "imminent";
      else if (diffDays <= 90) urgency = "upcoming";
      insertDeadline.run(ulid(), id, kd.date, kd.label, urgency);
    }

    count++;
    console.log(`  ✓ ${shortName}`);
  } catch (e) {
    console.error(`  ✗ Failed: ${shortName}`, (e as Error).message);
  }
}

console.log(`\nImported ${count} entries successfully.`);
db.close();
