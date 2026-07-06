// Milestone-based miss detection (upgrade plan B4). Tracker entries with key
// dates falling inside the digest week are *known* events — a consultation
// closing or a rule taking effect without a story is a provable miss, not a
// guess. We (1) surface these to the extractor as a watch list, (2) run one
// targeted search per milestone, and (3) report any that still produced no
// story so the run summary makes misses visible.

import { db } from "@/db";
import { entries } from "@/db/schema";
import type { KeyDate } from "@/lib/types";
import { parseJsonField } from "@/lib/utils";

export interface MilestoneEntry {
  entryId: string;
  shortName: string;
  jurisdictionCode: string;
  regulator: string | null;
  label: string;
  date: string;
}

export function findMilestoneEntries(weekStart: string, weekEnd: string): MilestoneEntry[] {
  const rows = db
    .select({
      id: entries.id,
      shortName: entries.shortName,
      jurisdiction: entries.jurisdiction,
      regulator: entries.regulator,
      keyDates: entries.keyDates,
    })
    .from(entries)
    .all();

  const out: MilestoneEntry[] = [];
  for (const row of rows) {
    const keyDates = parseJsonField<KeyDate[]>(row.keyDates) ?? [];
    for (const kd of keyDates) {
      if (kd.date >= weekStart && kd.date <= weekEnd) {
        out.push({
          entryId: row.id,
          shortName: row.shortName,
          jurisdictionCode: row.jurisdiction,
          regulator: row.regulator,
          label: kd.label,
          date: kd.date,
        });
      }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export function formatMilestoneWatch(items: MilestoneEntry[]): string {
  return items
    .map(
      (m) =>
        `- "${m.shortName}" — ${m.label} on ${m.date}${m.regulator ? ` (${m.regulator})` : ""}`
    )
    .join("\n");
}

export function milestoneSearchQuery(m: MilestoneEntry): string {
  return [m.shortName, m.label, m.regulator ?? ""].join(" ").trim();
}

interface StoryLike {
  title: string;
  summary: string;
  related_tracker_hint?: string | null;
}

/** Milestones that no extracted story appears to cover. */
export function findMissedMilestones(
  items: MilestoneEntry[],
  stories: StoryLike[]
): MilestoneEntry[] {
  return items.filter((m) => {
    const name = m.shortName.toLowerCase();
    return !stories.some(
      (s) =>
        s.related_tracker_hint?.toLowerCase() === name ||
        s.title.toLowerCase().includes(name) ||
        s.summary.toLowerCase().includes(name)
    );
  });
}
