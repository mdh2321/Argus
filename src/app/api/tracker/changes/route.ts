import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { entryChanges, entries } from "@/db/schema";
import { and, desc, eq, gte } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const limit = parseInt(params.get("limit") || "50");
  const since = params.get("since"); // ISO date string
  // Default to the applied history; callers can request 'proposed' (A1) or
  // 'dismissed'. `all` returns every lifecycle state.
  const status = params.get("status") || "applied";

  const conditions = [];
  if (since) {
    conditions.push(gte(entryChanges.changedAt, since));
  }
  if (status !== "all") {
    conditions.push(eq(entryChanges.status, status));
  }

  const changes = await db
    .select({
      change: entryChanges,
      entryShortName: entries.shortName,
      entryJurisdiction: entries.jurisdiction,
    })
    .from(entryChanges)
    .innerJoin(entries, eq(entryChanges.entryId, entries.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(entryChanges.changedAt))
    .limit(limit);

  return NextResponse.json(changes);
}
