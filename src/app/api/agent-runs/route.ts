import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { updateRuns } from "@/db/schema";
import { desc } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit = Math.min(Math.max(parseInt(limitParam ?? "20", 10) || 20, 1), 100);

  const rows = await db
    .select()
    .from(updateRuns)
    .orderBy(desc(updateRuns.runAt))
    .limit(limit);

  const runs = rows.map((r) => ({
    id: r.id,
    runAt: r.runAt,
    workflow: r.workflow,
    modelUsed: r.modelUsed,
    entriesCreated: r.entriesCreated,
    entriesUpdated: r.entriesUpdated,
    costEstimate: r.costEstimate,
  }));

  // Server-side aggregates for the panel header — keeps client render pure.
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent = runs.filter((r) => new Date(r.runAt).getTime() >= sevenDaysAgo);
  const summary = {
    last7dCount: recent.length,
    entriesTouched: recent.reduce(
      (sum, r) => sum + (r.entriesCreated ?? 0) + (r.entriesUpdated ?? 0),
      0
    ),
  };

  return NextResponse.json({ runs, total: runs.length, summary });
}
