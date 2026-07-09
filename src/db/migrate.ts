import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const dbPath = path.join(process.cwd(), "data", "sentinel.db");
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS entries (
    id TEXT PRIMARY KEY,
    jurisdiction TEXT NOT NULL,
    category TEXT NOT NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL,
    short_name TEXT NOT NULL,
    full_name TEXT NOT NULL,
    summary TEXT,
    applicability TEXT,
    key_criteria TEXT,
    why_it_matters TEXT,
    compliance_implications TEXT,
    exemptions TEXT,
    penalties TEXT,
    max_penalty_value REAL,
    max_penalty_currency TEXT,
    key_dates TEXT,
    next_key_date TEXT,
    impact_score INTEGER,
    source_urls TEXT,
    regulator TEXT,
    related_entries TEXT,
    tags TEXT,
    notes TEXT,
    flagged INTEGER DEFAULT 0,
    open_questions TEXT,
    related_context TEXT,
    section_confidence TEXT,
    section_claims TEXT,
    embedding BLOB,
    ai_generated INTEGER DEFAULT 0,
    archived INTEGER DEFAULT 0,
    last_reviewed TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS entry_changes (
    id TEXT PRIMARY KEY,
    entry_id TEXT NOT NULL REFERENCES entries(id),
    field_changed TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    change_summary TEXT,
    changed_by TEXT NOT NULL,
    source_url TEXT,
    changed_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS deadlines (
    id TEXT PRIMARY KEY,
    entry_id TEXT NOT NULL REFERENCES entries(id),
    date TEXT NOT NULL,
    label TEXT NOT NULL,
    urgency TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS update_runs (
    id TEXT PRIMARY KEY,
    run_at TEXT NOT NULL,
    entries_created INTEGER DEFAULT 0,
    entries_updated INTEGER DEFAULT 0,
    sources_checked TEXT,
    model_used TEXT,
    cost_estimate REAL
  );

  CREATE TABLE IF NOT EXISTS query_sessions (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS query_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES query_sessions(id),
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    cited_entry_ids TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_entries_jurisdiction ON entries(jurisdiction);
  CREATE INDEX IF NOT EXISTS idx_entries_category ON entries(category);
  CREATE INDEX IF NOT EXISTS idx_entries_status ON entries(status);
  CREATE INDEX IF NOT EXISTS idx_entries_impact ON entries(impact_score);
  CREATE INDEX IF NOT EXISTS idx_entries_next_key_date ON entries(next_key_date);
  CREATE INDEX IF NOT EXISTS idx_entries_archived ON entries(archived);
  CREATE TABLE IF NOT EXISTS source_documents (
    id TEXT PRIMARY KEY,
    entry_id TEXT NOT NULL REFERENCES entries(id),
    name TEXT NOT NULL,
    source_url TEXT,
    full_text TEXT,
    file_type TEXT,
    char_count INTEGER,
    added_by TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_source_documents_entry_id ON source_documents(entry_id);
  CREATE INDEX IF NOT EXISTS idx_entry_changes_entry_id ON entry_changes(entry_id);
  CREATE INDEX IF NOT EXISTS idx_deadlines_entry_id ON deadlines(entry_id);
  CREATE INDEX IF NOT EXISTS idx_deadlines_date ON deadlines(date);
  CREATE INDEX IF NOT EXISTS idx_query_messages_session ON query_messages(session_id);
`);

// New columns (idempotent via try/catch)
const alterColumns = [
  "ALTER TABLE source_documents ADD COLUMN source_authority TEXT",
  "ALTER TABLE source_documents ADD COLUMN verified_url INTEGER DEFAULT 0",
  "ALTER TABLE source_documents ADD COLUMN last_url_check TEXT",
  "ALTER TABLE source_documents ADD COLUMN content_hash TEXT",
  "ALTER TABLE source_documents ADD COLUMN retrieved_at TEXT",
  "ALTER TABLE entries ADD COLUMN applicability TEXT",
  "ALTER TABLE entries ADD COLUMN key_criteria TEXT",
  "ALTER TABLE entries ADD COLUMN exemptions TEXT",
  "ALTER TABLE entries ADD COLUMN related_context TEXT",
  "ALTER TABLE entries ADD COLUMN section_confidence TEXT",
  "ALTER TABLE entries ADD COLUMN section_claims TEXT",
  "ALTER TABLE entry_changes ADD COLUMN section_ref TEXT",
  "ALTER TABLE entry_changes ADD COLUMN source_snapshot_id TEXT",
  "ALTER TABLE signals ADD COLUMN relevance_score INTEGER",
  "ALTER TABLE signals ADD COLUMN relevance_rationale TEXT",
  "ALTER TABLE update_runs ADD COLUMN workflow TEXT",
  "ALTER TABLE update_runs ADD COLUMN profile_snapshot TEXT",
  "ALTER TABLE gap_suggestions ADD COLUMN source TEXT NOT NULL DEFAULT 'digest'",
  "ALTER TABLE deadlines ADD COLUMN kind TEXT",
];
for (const sql of alterColumns) {
  try { db.exec(sql); } catch { /* column already exists */ }
}

// Knowledge store tables
db.exec(`
  CREATE TABLE IF NOT EXISTS knowledge_items (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    item_type TEXT NOT NULL,
    jurisdiction TEXT,
    category TEXT,
    content TEXT NOT NULL,
    content_html TEXT,
    confidence TEXT NOT NULL DEFAULT 'unverified',
    grounded_in TEXT NOT NULL DEFAULT 'ai_knowledge',
    source_entry_ids TEXT,
    source_digest_slugs TEXT,
    source_doc_ids TEXT,
    claim_count INTEGER DEFAULT 0,
    grounded_claim_count INTEGER DEFAULT 0,
    grounding_ratio REAL DEFAULT 0,
    last_generated TEXT,
    last_verified TEXT,
    stale_after_days INTEGER DEFAULT 90,
    stale_trigger_ids TEXT,
    status TEXT NOT NULL DEFAULT 'current',
    period_from TEXT,
    period_to TEXT,
    auto_refresh INTEGER DEFAULT 0,
    generation_model TEXT,
    generation_prompt_hash TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS knowledge_claims (
    id TEXT PRIMARY KEY,
    knowledge_item_id TEXT NOT NULL REFERENCES knowledge_items(id),
    claim_text TEXT NOT NULL,
    source_doc_id TEXT REFERENCES source_documents(id),
    source_entry_id TEXT REFERENCES entries(id),
    source_section TEXT,
    grounding_type TEXT NOT NULL,
    confidence TEXT NOT NULL DEFAULT 'medium',
    disputed INTEGER DEFAULT 0,
    dispute_note TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_knowledge_items_type ON knowledge_items(item_type);
  CREATE INDEX IF NOT EXISTS idx_knowledge_items_status ON knowledge_items(status);
  CREATE INDEX IF NOT EXISTS idx_knowledge_items_slug ON knowledge_items(slug);
  CREATE INDEX IF NOT EXISTS idx_knowledge_claims_item ON knowledge_claims(knowledge_item_id);
  CREATE INDEX IF NOT EXISTS idx_knowledge_claims_entry ON knowledge_claims(source_entry_id);
  CREATE INDEX IF NOT EXISTS idx_knowledge_claims_doc ON knowledge_claims(source_doc_id);
`);

// Signals table
db.exec(`
  CREATE TABLE IF NOT EXISTS signals (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    scope TEXT NOT NULL,
    trend_direction TEXT NOT NULL,
    confidence TEXT NOT NULL DEFAULT 'medium',
    source_entry_ids TEXT,
    source_knowledge_ids TEXT,
    source_digest_story_ids TEXT,
    jurisdictions TEXT,
    categories TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    link TEXT,
    link_label TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_signals_status ON signals(status);
  CREATE INDEX IF NOT EXISTS idx_signals_created ON signals(created_at);
`);

// User profile table
db.exec(`
  CREATE TABLE IF NOT EXISTS user_profile (
    id TEXT PRIMARY KEY,
    company_name TEXT,
    company_description TEXT,
    products_services TEXT,
    sectors TEXT,
    jurisdictions_of_interest TEXT,
    role TEXT,
    focus_areas TEXT,
    free_text TEXT,
    updated_at TEXT NOT NULL
  );
`);

// Gap suggestions table
db.exec(`
  CREATE TABLE IF NOT EXISTS gap_suggestions (
    id TEXT PRIMARY KEY,
    suggested_short_name TEXT NOT NULL,
    suggested_full_name TEXT,
    suggested_jurisdiction TEXT NOT NULL,
    suggested_category TEXT NOT NULL,
    suggested_type TEXT,
    suggested_regulator TEXT,
    rationale TEXT NOT NULL,
    source_story_id TEXT,
    source_urls TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    accepted_entry_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_gap_suggestions_status ON gap_suggestions(status);
  CREATE INDEX IF NOT EXISTS idx_gap_suggestions_story ON gap_suggestions(source_story_id);
`);

// Matters — workstream bundles (the Spaces analog).
db.exec(`
  CREATE TABLE IF NOT EXISTS matters (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    instructions TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS matter_items (
    id TEXT PRIMARY KEY,
    matter_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    ref_id TEXT NOT NULL,
    label TEXT NOT NULL,
    href TEXT NOT NULL,
    added_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_matter_items_matter ON matter_items(matter_id);
`);

console.log("Database migrated successfully at", dbPath);
db.close();
