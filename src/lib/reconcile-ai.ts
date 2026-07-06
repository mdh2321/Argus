import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/db";
import { entries, entryChanges, digestStories, storyReferences } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { generateId, now, parseJsonField, toJsonString } from "@/lib/utils";
import { logAgentRun } from "@/lib/agent-runs";
import { STATUSES } from "@/lib/constants";
import type { KeyDate } from "@/lib/types";

// A1 — digest→entry reconciliation.
//
// For a digest story that references a tracked entry, a cheap Haiku pass reads
// the entry's current fields alongside the story text and emits a small set of
// *proposed* field changes (status / key dates / regulator / penalties). The
// proposals are written to `entry_changes` with status='proposed' and mutate
// nothing until a human approves them from the review queue. This is the single
// edge that makes the tracker "living": a story saying "the bill passed its
// third reading" now surfaces a proposed status change instead of silently
// going stale.

const anthropic = new Anthropic();
const MODEL = "claude-haiku-4-5-20251001";

// Haiku pricing ($/MTok). Kept local — the digest pipeline's CostGuard is not
// in scope here, but the run must still be logged with a cost for E1.
const HAIKU_PER_M_INPUT = 1.0;
const HAIKU_PER_M_OUTPUT = 5.0;

// The only fields the reconciler may touch — deliberately narrow to the
// mechanical, high-signal ones a news story actually updates. `key_dates` is
// proposed as a full replacement array so applying it is a single write and
// `next_key_date` / deadlines can be re-derived cleanly.
const RECONCILABLE_FIELDS = ["status", "key_dates", "regulator", "penalties"] as const;
type ReconcilableField = (typeof RECONCILABLE_FIELDS)[number];

const STATUS_VALUES = new Set<string>(STATUSES.map((s) => s.value));

interface RawChange {
  field?: string;
  new_value?: unknown;
  rationale?: string;
}

interface ValidatedChange {
  field: ReconcilableField;
  newValue: string; // for key_dates this is a JSON array string
  oldValue: string;
  rationale: string;
}

interface StoryRow {
  id: string;
  title: string;
  url: string | null;
  source: string;
  date: string;
  summary: string;
  articleText: string | null;
  takeaways: string | null;
}

/**
 * Run the reconciler over the given digest stories (typically the ones just
 * written by an ingest run). For every matched reference on those stories,
 * propose field changes to the referenced entry. Idempotent: a proposal
 * identical to one already pending is not duplicated. Logs a single
 * `reconcile` agent run with the aggregate Haiku cost.
 */
export async function reconcileDigestStories(
  storyIds: string[]
): Promise<{ proposals: number; costUsd: number }> {
  let proposals = 0;
  let costUsd = 0;

  for (const storyId of storyIds) {
    const story = db
      .select({
        id: digestStories.id,
        title: digestStories.title,
        url: digestStories.url,
        source: digestStories.source,
        date: digestStories.date,
        summary: digestStories.summary,
        articleText: digestStories.articleText,
        takeaways: digestStories.takeaways,
      })
      .from(digestStories)
      .where(eq(digestStories.id, storyId))
      .limit(1)
      .all()[0];
    if (!story) continue;

    // Matched references on this story, deduped to unique entry ids.
    const refs = db
      .select({ entryId: storyReferences.entryId })
      .from(storyReferences)
      .where(
        and(eq(storyReferences.storyId, storyId), eq(storyReferences.status, "matched"))
      )
      .all();
    const entryIds = [...new Set(refs.map((r) => r.entryId).filter((x): x is string => !!x))];

    for (const entryId of entryIds) {
      try {
        const result = await reconcileStoryEntry(story, entryId);
        proposals += result.proposals;
        costUsd += result.costUsd;
      } catch (err) {
        console.warn(`[reconcile] failed for story ${storyId} → entry ${entryId}:`, err);
      }
    }
  }

  if (costUsd > 0 || proposals > 0) {
    await logAgentRun({
      workflow: "reconcile",
      modelUsed: MODEL,
      entriesUpdated: 0, // proposals mutate nothing until approved
      costEstimate: costUsd,
    });
  }

  return { proposals, costUsd };
}

/**
 * Reconcile a single (story, entry) pair. Writes any validated proposals to
 * `entry_changes` with status='proposed'. Returns the number of proposals
 * written and the Haiku cost of the call.
 */
async function reconcileStoryEntry(
  story: StoryRow,
  entryId: string
): Promise<{ proposals: number; costUsd: number }> {
  const [entry] = db.select().from(entries).where(eq(entries.id, entryId)).all();
  if (!entry || entry.archived) return { proposals: 0, costUsd: 0 };

  const prompt = buildPrompt(story, entry);
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  const costUsd =
    (response.usage.input_tokens / 1_000_000) * HAIKU_PER_M_INPUT +
    (response.usage.output_tokens / 1_000_000) * HAIKU_PER_M_OUTPUT;

  const text = response.content[0]?.type === "text" ? response.content[0].text : "";
  const raw = parseChanges(text);
  const validated = raw
    .map((c) => validateChange(c, entry))
    .filter((c): c is ValidatedChange => c !== null);

  if (validated.length === 0) return { proposals: 0, costUsd };

  const ts = now();
  let written = 0;
  for (const change of validated) {
    // Idempotency: skip if an identical proposal is already pending.
    const dupe = db
      .select({ id: entryChanges.id })
      .from(entryChanges)
      .where(
        and(
          eq(entryChanges.entryId, entryId),
          eq(entryChanges.fieldChanged, change.field),
          eq(entryChanges.newValue, change.newValue),
          eq(entryChanges.status, "proposed")
        )
      )
      .limit(1)
      .all()[0];
    if (dupe) continue;

    db.insert(entryChanges)
      .values({
        id: generateId(),
        entryId,
        fieldChanged: change.field,
        oldValue: change.oldValue,
        newValue: change.newValue,
        changeSummary: change.rationale.slice(0, 500),
        changedBy: "ai",
        sourceUrl: story.url ?? null,
        sectionRef: null,
        sourceSnapshotId: null,
        changedAt: ts,
        status: "proposed",
      })
      .run();
    written++;
  }

  return { proposals: written, costUsd };
}

function buildPrompt(story: StoryRow, entry: typeof entries.$inferSelect): string {
  const keyDates = parseJsonField<KeyDate[]>(entry.keyDates) ?? [];
  const keyDatesBlock =
    keyDates.length > 0
      ? keyDates.map((k) => `  - ${k.date}: ${k.label}`).join("\n")
      : "  (none)";
  const takeaways = parseJsonField<string[]>(story.takeaways) ?? [];
  const takeawaysBlock = takeaways.length > 0 ? takeaways.map((t) => `- ${t}`).join("\n") : "(none)";
  const statusList = STATUSES.map((s) => s.value).join(", ");
  const body = (story.articleText ?? "").slice(0, 6000);

  return `You are reconciling a tracked legal instrument against a news story that mentions it. Your job is to detect whether the story reports a concrete, verifiable change to the instrument's tracked fields — and if so, propose the minimal update. Be conservative: propose a change ONLY when the story clearly states it. When in doubt, propose nothing.

TRACKED ENTRY (current state):
- Name: ${entry.shortName} — ${entry.fullName}
- Jurisdiction: ${entry.jurisdiction}
- Type: ${entry.type}
- Status: ${entry.status}
- Regulator: ${entry.regulator ?? "(none)"}
- Penalties: ${entry.penalties ?? "(none)"}
- Key dates:
${keyDatesBlock}

STORY:
- Title: ${story.title}
- Source: ${story.source} (${story.date})
- Summary: ${story.summary}
- Takeaways:
${takeawaysBlock}
${body ? `- Article text:\n"""\n${body}\n"""` : ""}

FIELDS YOU MAY PROPOSE CHANGES TO (nothing else):
- \`status\` — the instrument's lifecycle stage. MUST be one of: ${statusList}. Only propose if the story reports a lifecycle transition (e.g. a bill passing, a law commencing, a repeal).
- \`key_dates\` — commencement / consultation-close / compliance dates. Propose the FULL updated array (keep existing dates that still hold, add/adjust as the story reports). Each item is {"date":"YYYY-MM-DD","label":"..."}.
- \`regulator\` — only if the story names a different responsible regulator.
- \`penalties\` — only if the story reports a concrete change to penalty amounts/regime.

RULES:
- Propose a change only when the NEW value differs from the current value AND the story provides clear evidence for it.
- Never invent dates. Only include a date in \`key_dates\` if the story states it (or it already exists on the entry).
- Return an empty array if nothing in the story warrants a change. Under-propose rather than over-propose.

Return ONLY valid JSON (no commentary, no code fences):
{
  "changes": [
    { "field": "status", "new_value": "passed", "rationale": "Story reports the bill cleared its third reading on 3 Jul." }
  ]
}`;
}

function parseChanges(text: string): RawChange[] {
  const cleaned = text.replace(/```(?:json)?\s*/g, "").replace(/```\s*$/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < 0) return [];
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as { changes?: RawChange[] };
    return Array.isArray(parsed.changes) ? parsed.changes : [];
  } catch {
    return [];
  }
}

function validateChange(
  raw: RawChange,
  entry: typeof entries.$inferSelect
): ValidatedChange | null {
  const field = raw.field as ReconcilableField;
  if (!RECONCILABLE_FIELDS.includes(field)) return null;
  const rationale = typeof raw.rationale === "string" ? raw.rationale.trim() : "";

  if (field === "status") {
    const val = typeof raw.new_value === "string" ? raw.new_value.trim() : "";
    if (!STATUS_VALUES.has(val) || val === entry.status) return null;
    return { field, newValue: val, oldValue: entry.status, rationale };
  }

  if (field === "key_dates") {
    const arr = coerceKeyDates(raw.new_value);
    if (!arr) return null;
    // Store the canonical (sorted) JSON so re-runs dedupe cleanly and the
    // no-op check is order-insensitive.
    const newValue = normalizeKeyDatesJson(toJsonString(arr));
    if (newValue === normalizeKeyDatesJson(entry.keyDates)) return null;
    return { field, newValue, oldValue: entry.keyDates ?? "", rationale };
  }

  // regulator | penalties — plain non-empty strings differing from current.
  const val = typeof raw.new_value === "string" ? raw.new_value.trim() : "";
  if (!val) return null;
  const current = field === "regulator" ? entry.regulator : entry.penalties;
  if (val === (current ?? "")) return null;
  return { field, newValue: val, oldValue: current ?? "", rationale };
}

/** Accept the model's key_dates payload only if every item is a {date,label}. */
function coerceKeyDates(value: unknown): KeyDate[] | null {
  if (!Array.isArray(value)) return null;
  const out: KeyDate[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const date = (item as Record<string, unknown>).date;
    const label = (item as Record<string, unknown>).label;
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    out.push({ date, label: typeof label === "string" ? label : "" });
  }
  return out;
}

/** Canonical JSON for comparing two key-date arrays regardless of ordering. */
function normalizeKeyDatesJson(json: string | null): string {
  const arr = parseJsonField<KeyDate[]>(json) ?? [];
  const sorted = [...arr].sort((a, b) => (a.date + a.label).localeCompare(b.date + b.label));
  return toJsonString(sorted) ?? "[]";
}
