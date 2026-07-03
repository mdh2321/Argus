import { NextResponse } from "next/server";
import { db } from "@/db";
import { deadlines, entries } from "@/db/schema";
import { eq, asc } from "drizzle-orm";

export async function GET() {
  const rows = await db
    .select({
      id: deadlines.id,
      entryId: deadlines.entryId,
      date: deadlines.date,
      label: deadlines.label,
      urgency: deadlines.urgency,
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

  return NextResponse.json({ deadlines: rows });
}
