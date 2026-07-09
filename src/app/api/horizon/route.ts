import { NextResponse } from "next/server";
import { db } from "@/db";
import { deadlines, entries } from "@/db/schema";
import { eq, asc, gte, and } from "drizzle-orm";
import { classifyDeadlineKind } from "@/lib/deadline-kind";
import type { DeadlineKind } from "@/lib/types";

// Forward-looking outlook feed for the Horizon page: every future key date on
// an active entry, with enough entry context to render a screen-shareable row
// (flag, status, impact, one-line business consequence via the dual lenses).
export async function GET() {
  const today = new Date().toISOString().slice(0, 10);

  const rows = await db
    .select({
      id: deadlines.id,
      entryId: deadlines.entryId,
      date: deadlines.date,
      label: deadlines.label,
      kind: deadlines.kind,
      shortName: entries.shortName,
      jurisdiction: entries.jurisdiction,
      category: entries.category,
      status: entries.status,
      impactScore: entries.impactScore,
      regulator: entries.regulator,
      impactOnUs: entries.impactOnUs,
      impactOnCustomers: entries.impactOnCustomers,
      whyItMatters: entries.whyItMatters,
    })
    .from(deadlines)
    .innerJoin(entries, eq(deadlines.entryId, entries.id))
    .where(and(eq(entries.archived, false), gte(deadlines.date, today)))
    .orderBy(asc(deadlines.date));

  // An entry can have several labels on the same date ("comes into force" +
  // "compliance deadline"). One row per (entry, date) keeps the outlook tight.
  const KIND_RANK: Record<DeadlineKind, number> = { compliance: 3, process: 2, watch: 1 };
  const merged = new Map<
    string,
    Omit<(typeof rows)[number], "kind"> & { labels: string[]; kind: DeadlineKind }
  >();
  for (const row of rows) {
    const key = `${row.entryId}:${row.date}`;
    const kind = (row.kind as DeadlineKind | null) ?? classifyDeadlineKind(row.label);
    const existing = merged.get(key);
    if (existing) {
      existing.labels.push(row.label);
      // When labels merge, the most demanding kind describes the date.
      if (KIND_RANK[kind] > KIND_RANK[existing.kind]) existing.kind = kind;
    } else {
      merged.set(key, { ...row, labels: [row.label], kind });
    }
  }

  const items = [...merged.values()].map((m) => {
    const { labels, ...rest } = m;
    return { ...rest, label: labels.join(" · ") };
  });

  return NextResponse.json({ items, today });
}
