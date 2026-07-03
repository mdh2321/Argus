import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gapSuggestions, entries, digestStories } from "@/db/schema";
import { eq } from "drizzle-orm";
import { generateId, now, toJsonString, parseJsonField } from "@/lib/utils";
import { serializeGapSuggestion } from "@/lib/gap-ai";
import { kickOffSummaryGeneration } from "@/lib/summary-pipeline";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await request.json()) as { action?: "accept" | "dismiss" };

  const [existing] = db.select().from(gapSuggestions).where(eq(gapSuggestions.id, id)).all();
  if (!existing) {
    return NextResponse.json({ error: "Suggestion not found" }, { status: 404 });
  }

  if (existing.status !== "pending") {
    return NextResponse.json({ error: `Suggestion already ${existing.status}` }, { status: 409 });
  }

  const timestamp = now();

  if (body.action === "dismiss") {
    db.update(gapSuggestions)
      .set({ status: "dismissed", updatedAt: timestamp })
      .where(eq(gapSuggestions.id, id))
      .run();
    const [row] = db.select().from(gapSuggestions).where(eq(gapSuggestions.id, id)).all();
    return NextResponse.json(row ? serializeGapSuggestion(row) : { ok: true });
  }

  if (body.action === "accept") {
    const entryId = generateId();
    const sourceUrls = parseJsonField<string[]>(existing.sourceUrls) || [];
    const trackerSources = sourceUrls.map((url) => ({ url, tier: "model_knowledge" as const }));

    db.insert(entries)
      .values({
        id: entryId,
        jurisdiction: existing.suggestedJurisdiction,
        category: existing.suggestedCategory,
        type: existing.suggestedType || "legislation",
        status: "monitoring",
        shortName: existing.suggestedShortName,
        fullName: existing.suggestedFullName || existing.suggestedShortName,
        summary: null,
        applicability: null,
        keyCriteria: null,
        whyItMatters: null,
        complianceImplications: null,
        exemptions: null,
        penalties: null,
        regulator: existing.suggestedRegulator,
        sourceUrls: trackerSources.length > 0 ? toJsonString(trackerSources) : null,
        notes: `Created from gap suggestion. Rationale: ${existing.rationale}`,
        relatedContext: null,
        sectionConfidence: null,
        sectionClaims: null,
        aiGenerated: true,
        archived: false,
        lastReviewed: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();

    db.update(gapSuggestions)
      .set({
        status: "accepted",
        acceptedEntryId: entryId,
        updatedAt: timestamp,
      })
      .where(eq(gapSuggestions.id, id))
      .run();

    // Link the source story to the new entry if we have one
    if (existing.sourceStoryId) {
      db.update(digestStories)
        .set({ trackerEntryId: entryId, updatedAt: timestamp })
        .where(eq(digestStories.id, existing.sourceStoryId))
        .run();
    }

    // Auto-kick a preliminary summary so the gap-suggested entry doesn't
    // land empty in the tracker. Gap suggestions never carry summary
    // content so this always fires.
    void kickOffSummaryGeneration(entryId).catch((err) => {
      console.error(`[gap-suggestion accept] auto-kickoff failed for ${entryId}:`, err);
    });

    return NextResponse.json({ ok: true, entryId });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
