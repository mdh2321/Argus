import { NextResponse } from "next/server";
import { db } from "@/db";
import { sourceDocuments, digestIssues, updateRuns } from "@/db/schema";
import { sql, desc, isNotNull } from "drizzle-orm";

// Powers the dashboard trust strip: proof the desk is alive and grounded.
export async function GET() {
  const [docs] = db
    .select({
      sourceDocs: sql<number>`count(*)`,
      groundedEntries: sql<number>`count(distinct ${sourceDocuments.entryId})`,
    })
    .from(sourceDocuments)
    .all();

  const [lastDelivered] = db
    .select({ deliveredAt: digestIssues.deliveredAt, weekOf: digestIssues.weekOf })
    .from(digestIssues)
    .where(isNotNull(digestIssues.deliveredAt))
    .orderBy(desc(digestIssues.deliveredAt))
    .limit(1)
    .all();

  const [lastRun] = db
    .select({ runAt: updateRuns.runAt, workflow: updateRuns.workflow })
    .from(updateRuns)
    .orderBy(desc(updateRuns.runAt))
    .limit(1)
    .all();

  return NextResponse.json({
    groundedEntries: docs?.groundedEntries ?? 0,
    sourceDocs: docs?.sourceDocs ?? 0,
    lastDigestDeliveredAt: lastDelivered?.deliveredAt ?? null,
    lastDigestWeekOf: lastDelivered?.weekOf ?? null,
    lastAgentRunAt: lastRun?.runAt ?? null,
    lastAgentWorkflow: lastRun?.workflow ?? null,
  });
}
