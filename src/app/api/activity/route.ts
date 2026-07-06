import { NextResponse } from "next/server";
import { db } from "@/db";
import { updateRuns, entries } from "@/db/schema";
import { desc, eq, sql } from "drizzle-orm";

// E1 — activity + cost. A read-only summary over update_runs (what Sentinel
// spent, by month, and the recent runs) plus a live count of in-flight
// analyses. Powers the header popover: a "running" pill, a completion toast,
// and a visible monthly spend so the tool stays honest about cost.

export async function GET() {
  // Monthly spend, most recent months first.
  const monthly = db
    .select({
      month: sql<string>`substr(${updateRuns.runAt}, 1, 7)`,
      total: sql<number>`coalesce(sum(${updateRuns.costEstimate}), 0)`,
      runs: sql<number>`count(*)`,
    })
    .from(updateRuns)
    .groupBy(sql`substr(${updateRuns.runAt}, 1, 7)`)
    .orderBy(desc(sql`substr(${updateRuns.runAt}, 1, 7)`))
    .limit(6)
    .all();

  const recent = db
    .select({
      id: updateRuns.id,
      runAt: updateRuns.runAt,
      workflow: updateRuns.workflow,
      modelUsed: updateRuns.modelUsed,
      costEstimate: updateRuns.costEstimate,
      entriesCreated: updateRuns.entriesCreated,
      entriesUpdated: updateRuns.entriesUpdated,
    })
    .from(updateRuns)
    .orderBy(desc(updateRuns.runAt))
    .limit(12)
    .all();

  // In-flight analyses — the summary pipeline sets summaryStatus='running'.
  const inFlight = db
    .select({ id: entries.id, shortName: entries.shortName })
    .from(entries)
    .where(eq(entries.summaryStatus, "running"))
    .all();

  const thisMonth = new Date().toISOString().slice(0, 7);
  const thisMonthSpend = monthly.find((m) => m.month === thisMonth)?.total ?? 0;

  return NextResponse.json({
    thisMonth,
    thisMonthSpend,
    monthly,
    recent,
    inFlight,
  });
}
