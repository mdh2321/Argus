import "server-only";

import { db } from "@/db";
import { updateRuns, userProfile } from "@/db/schema";
import { eq } from "drizzle-orm";
import { generateId, now, toJsonString } from "@/lib/utils";
import type { Workflow } from "@/lib/agent-workflows";

export type { Workflow } from "@/lib/agent-workflows";
export { workflowLabel } from "@/lib/agent-workflows";

interface LogAgentRunInput {
  workflow: Workflow;
  modelUsed?: string | null;
  entriesCreated?: number;
  entriesUpdated?: number;
  costEstimate?: number | null;
  sourcesChecked?: string[] | null;
}

/**
 * Record a Sentinel agent run in updateRuns with a profile snapshot.
 * Must never throw — logging failures are swallowed so generation flows aren't broken.
 */
export async function logAgentRun(input: LogAgentRunInput): Promise<void> {
  try {
    const [profile] = db
      .select()
      .from(userProfile)
      .where(eq(userProfile.id, "default"))
      .all();

    await db.insert(updateRuns).values({
      id: generateId(),
      runAt: now(),
      workflow: input.workflow,
      profileSnapshot: profile ? toJsonString(profile) : null,
      modelUsed: input.modelUsed ?? null,
      entriesCreated: input.entriesCreated ?? 0,
      entriesUpdated: input.entriesUpdated ?? 0,
      costEstimate: input.costEstimate ?? null,
      sourcesChecked: input.sourcesChecked ? toJsonString(input.sourcesChecked) : null,
    });
  } catch (e) {
    console.error("logAgentRun failed:", e);
  }
}
