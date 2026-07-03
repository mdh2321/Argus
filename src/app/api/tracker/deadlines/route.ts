import { NextResponse } from "next/server";
import { db } from "@/db";
import { deadlines, entries } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { calculateUrgency } from "@/lib/utils";

export async function GET() {
  const rows = await db
    .select({
      id: deadlines.id,
      entryId: deadlines.entryId,
      date: deadlines.date,
      label: deadlines.label,
      entryShortName: entries.shortName,
      entryJurisdiction: entries.jurisdiction,
      entryImpactScore: entries.impactScore,
      entryStatus: entries.status,
      entryRegulator: entries.regulator,
    })
    .from(deadlines)
    .innerJoin(entries, eq(deadlines.entryId, entries.id))
    .where(eq(entries.archived, false))
    .orderBy(asc(deadlines.date));

  // Urgency is derived from the date at read time — the stored column drifts
  // as dates pass (June 2026 audit P0).
  return NextResponse.json({
    deadlines: rows.map((r) => ({ ...r, urgency: calculateUrgency(r.date) })),
  });
}
