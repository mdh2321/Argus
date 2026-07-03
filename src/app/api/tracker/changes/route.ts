import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { entryChanges, entries } from "@/db/schema";
import { desc, eq, gte } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const limit = parseInt(params.get("limit") || "50");
  const since = params.get("since"); // ISO date string

  const conditions = [];
  if (since) {
    conditions.push(gte(entryChanges.changedAt, since));
  }

  const changes = await db
    .select({
      change: entryChanges,
      entryShortName: entries.shortName,
      entryJurisdiction: entries.jurisdiction,
    })
    .from(entryChanges)
    .innerJoin(entries, eq(entryChanges.entryId, entries.id))
    .where(conditions.length > 0 ? conditions[0] : undefined)
    .orderBy(desc(entryChanges.changedAt))
    .limit(limit);

  return NextResponse.json(changes);
}
