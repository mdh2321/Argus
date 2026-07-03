import { db } from "@/db";
import { entries, entryChanges, deadlines } from "@/db/schema";
import { eq } from "drizzle-orm";
import { generateId, now, calculateUrgency, parseJsonField } from "./utils";
import type {
  Entry,
  KeyDate,
  EntrySectionClaims,
  EntrySectionConfidence,
  EscalationTrigger,
  ComplianceChecklistItem,
  ThresholdTest,
  SummaryStatus,
  SummaryDepth,
  AnalysisJobs,
} from "./types";
import { upgradeSourceUrls } from "./source-tiers";

/** Serialize a DB row into an Entry object with parsed JSON fields */
export function serializeEntry(row: typeof entries.$inferSelect): Entry {
  return {
    ...row,
    flagged: !!row.flagged,
    aiGenerated: !!row.aiGenerated,
    archived: !!row.archived,
    keyDates: parseJsonField<KeyDate[]>(row.keyDates),
    sourceUrls: upgradeSourceUrls(parseJsonField(row.sourceUrls)),
    relatedEntries: parseJsonField<string[]>(row.relatedEntries),
    tags: parseJsonField<string[]>(row.tags),
    sectionConfidence: parseJsonField<EntrySectionConfidence>(row.sectionConfidence),
    sectionClaims: parseJsonField<EntrySectionClaims>(row.sectionClaims),
    escalationTriggers: parseJsonField<EscalationTrigger[]>(row.escalationTriggers),
    complianceChecklist: parseJsonField<ComplianceChecklistItem[]>(row.complianceChecklist),
    thresholdTests: parseJsonField<ThresholdTest[]>(row.thresholdTests),
    summaryStatus: normalizeSummaryStatus(row.summaryStatus),
    analysisJobs: parseJsonField<AnalysisJobs>(row.analysisJobs),
    summaryDepth: normalizeSummaryDepth(row.summaryDepth),
  };
}

function normalizeSummaryDepth(value: string | null): SummaryDepth | null {
  return value === "preliminary" || value === "full" ? value : null;
}

function normalizeSummaryStatus(value: string): SummaryStatus {
  return value === "running" || value === "failed" ? value : "idle";
}

export interface ChangeAnchor {
  sectionRef?: string;        // e.g. "Section 26(1)"
  sourceSnapshotId?: string;  // source_documents.id this change was anchored to
  sourceUrl?: string;         // canonical URL of the source
}

export interface ChangeContext {
  /** Applied to all changes in this batch unless overridden per-field */
  default?: ChangeAnchor;
  /** Per-field overrides, keyed by TS field name (e.g. "summary", "whyItMatters") */
  fields?: Record<string, ChangeAnchor>;
}

/** Log field changes between old and new entry values */
export async function logChanges(
  entryId: string,
  oldEntry: typeof entries.$inferSelect,
  updates: Record<string, unknown>,
  changedBy: "ai" | "manual" = "manual",
  context?: ChangeContext
) {
  const timestamp = now();
  const fieldsToTrack = [
    "jurisdiction", "category", "type", "status", "shortName", "fullName",
    "summary", "applicability", "keyCriteria", "whyItMatters", "complianceImplications",
    "impactOnUs", "impactOnCustomers",
    "exemptions", "penalties",
    "maxPenaltyValue", "maxPenaltyCurrency", "impactScore", "regulator",
    "notes", "flagged", "openQuestions", "relatedContext",
  ];

  const dbFieldMap: Record<string, string> = {
    shortName: "short_name", fullName: "full_name", whyItMatters: "why_it_matters",
    impactOnUs: "impact_on_us", impactOnCustomers: "impact_on_customers",
    applicability: "applicability", keyCriteria: "key_criteria",
    complianceImplications: "compliance_implications", maxPenaltyValue: "max_penalty_value",
    maxPenaltyCurrency: "max_penalty_currency", impactScore: "impact_score", exemptions: "exemptions",
    openQuestions: "open_questions", relatedContext: "related_context",
  };

  for (const field of fieldsToTrack) {
    if (field in updates) {
      const oldVal = String((oldEntry as Record<string, unknown>)[field] ?? "");
      const newVal = String(updates[field] ?? "");
      if (oldVal !== newVal) {
        const anchor = context?.fields?.[field] ?? context?.default;
        await db.insert(entryChanges).values({
          id: generateId(),
          entryId,
          fieldChanged: dbFieldMap[field] || field,
          oldValue: oldVal,
          newValue: newVal,
          changeSummary: `${dbFieldMap[field] || field} changed`,
          changedBy,
          sourceUrl: anchor?.sourceUrl ?? null,
          sectionRef: anchor?.sectionRef ?? null,
          sourceSnapshotId: anchor?.sourceSnapshotId ?? null,
          changedAt: timestamp,
        });
      }
    }
  }
}

/** Sync deadlines table from key_dates JSON */
export async function syncDeadlines(entryId: string, keyDatesJson: string | null) {
  // Remove old deadlines
  await db.delete(deadlines).where(eq(deadlines.entryId, entryId));

  const keyDates = parseJsonField<KeyDate[]>(keyDatesJson);
  if (!keyDates || keyDates.length === 0) return;

  for (const kd of keyDates) {
    if (!kd.date) continue;
    await db.insert(deadlines).values({
      id: generateId(),
      entryId,
      date: kd.date,
      label: kd.label || "",
      urgency: calculateUrgency(kd.date),
    });
  }
}

/** Compute next_key_date from key_dates JSON */
export function computeNextKeyDate(keyDatesJson: string | null): string | null {
  const keyDates = parseJsonField<KeyDate[]>(keyDatesJson);
  if (!keyDates || keyDates.length === 0) return null;

  const today = new Date().toISOString().split("T")[0];
  const futureDates = keyDates
    .filter((kd) => kd.date && kd.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));

  return futureDates.length > 0 ? futureDates[0].date : null;
}

// Re-export trust badges (client-safe module)
export { computeTrustBadges, type TrustBadge } from "./trust-badges";
