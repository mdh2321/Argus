import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { entries } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { generateId, now, toJsonString } from "@/lib/utils";
import { logChanges, syncDeadlines, computeNextKeyDate } from "@/lib/entry-helpers";
import { normalizeSourceUrls } from "@/lib/source-tiers";
import { logAgentRun } from "@/lib/agent-runs";
import { kickOffSummaryGeneration } from "@/lib/summary-pipeline";
import type { IngestRequest, IngestResponse } from "@/lib/types";

export async function POST(request: NextRequest) {
  const body: IngestRequest = await request.json();
  const timestamp = now();

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const item of body.entries) {
    try {
      if (item.action === "create") {
        // Check for duplicates: same jurisdiction + full_name
        if (item.data.jurisdiction && item.data.fullName) {
          const [existing] = await db
            .select()
            .from(entries)
            .where(
              and(
                eq(entries.jurisdiction, item.data.jurisdiction),
                eq(entries.fullName, item.data.fullName)
              )
            );

          if (existing) {
            // Treat as update
            await logChanges(existing.id, existing, item.data as Record<string, unknown>, "ai");

            const keyDatesJson = item.data.keyDates ? toJsonString(item.data.keyDates) : existing.keyDates;
            const nextKeyDate = computeNextKeyDate(keyDatesJson);

            await db.update(entries).set({
              ...item.data,
              keyDates: keyDatesJson,
              nextKeyDate,
              sourceUrls: item.data.sourceUrls ? toJsonString(normalizeSourceUrls(item.data.sourceUrls)) : existing.sourceUrls,
              relatedEntries: item.data.relatedEntries ? toJsonString(item.data.relatedEntries) : existing.relatedEntries,
              tags: item.data.tags ? toJsonString(item.data.tags) : existing.tags,
              sectionClaims: item.data.sectionClaims ? toJsonString(item.data.sectionClaims) : existing.sectionClaims,
              sectionConfidence: item.data.sectionConfidence ? toJsonString(item.data.sectionConfidence) : existing.sectionConfidence,
              updatedAt: timestamp,
            } as Record<string, unknown>).where(eq(entries.id, existing.id));

            await syncDeadlines(existing.id, keyDatesJson);
            updated++;
            continue;
          }
        }

        const id = generateId();
        const keyDatesJson = item.data.keyDates ? toJsonString(item.data.keyDates) : null;
        const nextKeyDate = computeNextKeyDate(keyDatesJson);

        await db.insert(entries).values({
          id,
          jurisdiction: item.data.jurisdiction || "",
          category: item.data.category || "",
          type: item.data.type || "legislation",
          status: item.data.status || "monitoring",
          shortName: item.data.shortName || "",
          fullName: item.data.fullName || "",
          summary: item.data.summary || null,
          applicability: item.data.applicability || null,
          keyCriteria: item.data.keyCriteria || null,
          whyItMatters: item.data.whyItMatters || null,
          complianceImplications: item.data.complianceImplications || null,
          exemptions: item.data.exemptions || null,
          penalties: item.data.penalties || null,
          maxPenaltyValue: item.data.maxPenaltyValue || null,
          maxPenaltyCurrency: item.data.maxPenaltyCurrency || null,
          keyDates: keyDatesJson,
          nextKeyDate,
          impactScore: item.data.impactScore || null,
          sourceUrls: item.data.sourceUrls ? toJsonString(normalizeSourceUrls(item.data.sourceUrls)) : null,
          regulator: item.data.regulator || null,
          relatedEntries: item.data.relatedEntries ? toJsonString(item.data.relatedEntries) : null,
          tags: item.data.tags ? toJsonString(item.data.tags) : null,
          notes: item.data.notes || null,
          flagged: item.data.flagged || false,
          openQuestions: item.data.openQuestions || null,
          relatedContext: item.data.relatedContext || null,
          sectionClaims: item.data.sectionClaims ? toJsonString(item.data.sectionClaims) : null,
          sectionConfidence: item.data.sectionConfidence ? toJsonString(item.data.sectionConfidence) : null,
          parentEntryId: item.data.parentEntryId || null,
          aiGenerated: item.data.aiGenerated ?? true,
          archived: false,
          lastReviewed: timestamp,
          createdAt: timestamp,
          updatedAt: timestamp,
        });

        await syncDeadlines(id, keyDatesJson);

        // Auto-kick a preliminary summary when the ingested item didn't
        // ship with summary content. Skipped when the ingest payload
        // already provided one.
        if (!item.data.summary) {
          void kickOffSummaryGeneration(id).catch((err) => {
            console.error(`[ingest] auto-kickoff failed for ${id}:`, err);
          });
        }

        created++;
      } else if (item.action === "update" && item.id) {
        const [existing] = await db.select().from(entries).where(eq(entries.id, item.id));
        if (!existing) {
          errors.push(`Entry ${item.id} not found for update`);
          skipped++;
          continue;
        }

        await logChanges(existing.id, existing, item.data as Record<string, unknown>, "ai");

        const keyDatesJson = item.data.keyDates ? toJsonString(item.data.keyDates) : existing.keyDates;
        const nextKeyDate = computeNextKeyDate(keyDatesJson);

        await db.update(entries).set({
          ...item.data,
          keyDates: keyDatesJson,
          nextKeyDate,
          sourceUrls: item.data.sourceUrls ? toJsonString(normalizeSourceUrls(item.data.sourceUrls)) : existing.sourceUrls,
          relatedEntries: item.data.relatedEntries ? toJsonString(item.data.relatedEntries) : existing.relatedEntries,
          tags: item.data.tags ? toJsonString(item.data.tags) : existing.tags,
          sectionClaims: item.data.sectionClaims ? toJsonString(item.data.sectionClaims) : existing.sectionClaims,
          sectionConfidence: item.data.sectionConfidence ? toJsonString(item.data.sectionConfidence) : existing.sectionConfidence,
          updatedAt: timestamp,
        } as Record<string, unknown>).where(eq(entries.id, item.id));

        await syncDeadlines(item.id, keyDatesJson);
        updated++;
      }
    } catch (e) {
      errors.push(`Error processing entry: ${(e as Error).message}`);
      skipped++;
    }
  }

  // Log the run
  await logAgentRun({
    workflow: "ingest",
    entriesCreated: created,
    entriesUpdated: updated,
    sourcesChecked: body.run_metadata?.sources_checked ?? null,
    modelUsed: body.run_metadata?.model_used ?? null,
    costEstimate: body.run_metadata?.cost_estimate ?? null,
  });

  const response: IngestResponse = { created, updated, skipped, errors };
  return NextResponse.json(response);
}
