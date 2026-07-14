import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { entries } from "@/db/schema";
import { generateId, now, toJsonString } from "@/lib/utils";
import { computeNextKeyDate, serializeEntry, syncDeadlines } from "@/lib/entry-helpers";
import { extractFromUrl, extractFromDocument, searchAndExtract, type CapturedDraft } from "@/lib/capture-ai";
import { kickOffIntake } from "@/lib/intake-pipeline";
import { eq } from "drizzle-orm";

export const maxDuration = 120;

type CaptureMode = "url" | "document" | "describe";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const mode: CaptureMode | undefined = body?.mode;

  let draft: CapturedDraft;
  const extraTags: string[] = ["ai-capture", "needs-review"];

  try {
    if (mode === "url") {
      const url = typeof body?.url === "string" ? body.url.trim() : "";
      if (!url) return NextResponse.json({ error: "Missing url" }, { status: 400 });
      draft = await extractFromUrl(url);
      extraTags.push("url-capture");
    } else if (mode === "document") {
      const name = typeof body?.name === "string" ? body.name.trim() : "";
      const text = typeof body?.text === "string" ? body.text : "";
      if (!name || !text.trim()) {
        return NextResponse.json({ error: "Missing document name or text" }, { status: 400 });
      }
      draft = await extractFromDocument({ name, text });
      extraTags.push("document-upload");
    } else if (mode === "describe") {
      const description = typeof body?.description === "string" ? body.description.trim() : "";
      if (!description) return NextResponse.json({ error: "Missing description" }, { status: 400 });
      draft = await searchAndExtract(description);
      extraTags.push("describe-search");
    } else {
      return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
    }
  } catch (err) {
    console.error("[capture] extraction failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Extraction failed" },
      { status: 500 }
    );
  }

  const timestamp = now();
  const id = generateId();
  const keyDatesJson = draft.keyDates.length > 0 ? toJsonString(draft.keyDates) : null;
  const nextKeyDate = computeNextKeyDate(keyDatesJson);
  const mergedTags = Array.from(new Set([...extraTags, ...draft.tags]));

  await db.insert(entries).values({
    id,
    jurisdiction: draft.jurisdiction,
    category: draft.category,
    type: draft.type,
    status: draft.status,
    shortName: draft.shortName,
    fullName: draft.fullName,
    summary: draft.summary,
    applicability: null,
    keyCriteria: null,
    whyItMatters: draft.whyItMatters,
    complianceImplications: draft.complianceImplications,
    exemptions: null,
    penalties: draft.penalties,
    maxPenaltyValue: null,
    maxPenaltyCurrency: null,
    keyDates: keyDatesJson,
    nextKeyDate,
    impactScore: draft.impactScore,
    sourceUrls: draft.sourceUrls ? toJsonString(draft.sourceUrls) : null,
    regulator: draft.regulator,
    relatedEntries: null,
    tags: mergedTags.length ? toJsonString(mergedTags) : null,
    notes: draft.notes,
    flagged: true,
    openQuestions: draft.openQuestions,
    relatedContext: null,
    sectionConfidence: null,
    sectionClaims: null,
    aiGenerated: true,
    archived: false,
    lastReviewed: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  await syncDeadlines(id, keyDatesJson);

  // Intake pipeline: resolve candidate sources, verify them against the
  // entry, auto-attach verified official documents, then run the analysis at
  // the depth the evidence supports. Replaces the old bare preliminary kick.
  void kickOffIntake(id).catch((err) => {
    console.error(`[capture] intake kickoff failed for ${id}:`, err);
  });

  const [created] = await db.select().from(entries).where(eq(entries.id, id));
  return NextResponse.json({ entry: serializeEntry(created) }, { status: 201 });
}
