import "server-only";
import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/db";
import { entries, storyReferences, digestStories } from "@/db/schema";
import { eq } from "drizzle-orm";
import { generateId, now, toJsonString } from "@/lib/utils";
import { getProfileContext } from "@/lib/profile-context";
import { TRACKABLE_ENTRY_TYPES } from "@/lib/constants";
import { computeNextKeyDate } from "@/lib/entry-helpers";
import { kickOffSummaryGeneration } from "@/lib/summary-pipeline";

export const maxDuration = 60;

const anthropic = new Anthropic();
const DRAFT_MODEL = "claude-haiku-4-5-20251001";

interface CreateBody {
  referenceId: string;
  overrides?: {
    shortName?: string;
    fullName?: string;
    jurisdiction?: string;
    category?: string;
    type?: string;
    regulator?: string;
  };
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as CreateBody;

  if (!body.referenceId) {
    return NextResponse.json({ error: "referenceId required" }, { status: 400 });
  }

  const ref = db
    .select()
    .from(storyReferences)
    .where(eq(storyReferences.id, body.referenceId))
    .get();

  if (!ref) {
    return NextResponse.json({ error: "Reference not found" }, { status: 404 });
  }

  if (ref.entryId) {
    return NextResponse.json(
      { error: "Reference already linked to an entry", entryId: ref.entryId },
      { status: 409 }
    );
  }

  const story = db
    .select()
    .from(digestStories)
    .where(eq(digestStories.id, ref.storyId))
    .get();

  if (!story) {
    return NextResponse.json({ error: "Source story not found" }, { status: 404 });
  }

  // Compose the entry metadata from the proposal + any user overrides.
  const overrides = body.overrides ?? {};
  const shortName = (overrides.shortName ?? ref.proposedShortName ?? ref.text ?? "").trim();
  const fullName = (overrides.fullName ?? ref.proposedFullName ?? shortName).trim();
  const jurisdiction = (overrides.jurisdiction ?? ref.proposedJurisdiction ?? story.jurisdictionCode ?? "").trim().toUpperCase();
  const category = (overrides.category ?? ref.proposedCategory ?? "").trim();
  const type = (overrides.type ?? ref.proposedType ?? "").trim();
  const regulator = (overrides.regulator ?? ref.proposedRegulator ?? null) || null;

  if (!shortName || !jurisdiction || !category || !type) {
    return NextResponse.json(
      {
        error: "Missing required fields",
        required: { shortName, jurisdiction, category, type },
      },
      { status: 400 }
    );
  }

  if (!TRACKABLE_ENTRY_TYPES.includes(type as typeof TRACKABLE_ENTRY_TYPES[number])) {
    return NextResponse.json(
      { error: `Type "${type}" is not a trackable entry type` },
      { status: 400 }
    );
  }

  // Story-grounded drafting (Phase A): summary + whyItMatters only.
  const drafted = await draftFromStory({
    shortName,
    fullName,
    jurisdiction,
    type,
    category,
    storyTitle: story.title,
    storySummary: story.summary,
    storyUrl: story.url,
  });

  const ts = now();
  const entryId = generateId();
  const sourceUrls = story.url ? toJsonString([story.url]) : null;

  db.insert(entries)
    .values({
      id: entryId,
      jurisdiction,
      category,
      type,
      status: "monitoring",
      shortName: shortName.slice(0, 200),
      fullName: fullName.slice(0, 500),
      summary: drafted.summary,
      applicability: null,
      keyCriteria: null,
      whyItMatters: drafted.whyItMatters,
      complianceImplications: null,
      exemptions: null,
      penalties: null,
      keyDates: null,
      nextKeyDate: computeNextKeyDate(null),
      impactScore: drafted.impactScore,
      sourceUrls,
      regulator,
      aliases: null,
      relatedContext: null,
      sectionConfidence: null,
      sectionClaims: null,
      aiGenerated: true,
      archived: false,
      lastReviewed: ts,
      createdAt: ts,
      updatedAt: ts,
    })
    .run();

  // Link this reference to the new entry.
  db.update(storyReferences)
    .set({
      entryId,
      status: "matched",
      matchConfidence: 1.0,
      updatedAt: ts,
    })
    .where(eq(storyReferences.id, ref.id))
    .run();

  // Auto-kick a preliminary summary if the Haiku-drafted summary is empty
  // (the draft model can return blank when the story is too thin).
  if (!drafted.summary) {
    void kickOffSummaryGeneration(entryId).catch((err) => {
      console.error(`[from-reference] auto-kickoff failed for ${entryId}:`, err);
    });
  }

  return NextResponse.json(
    {
      ok: true,
      entryId,
      referenceId: ref.id,
    },
    { status: 201 }
  );
}

interface DraftInput {
  shortName: string;
  fullName: string;
  jurisdiction: string;
  type: string;
  category: string;
  storyTitle: string;
  storySummary: string;
  storyUrl: string | null;
}

interface DraftOutput {
  summary: string;
  whyItMatters: string;
  impactScore: number | null;
}

async function draftFromStory(input: DraftInput): Promise<DraftOutput> {
  const profileContext = await getProfileContext();

  const prompt = `You are drafting a tracker entry for the Argus legal intelligence platform from a single source news story. The entry will collect future stories about this same legal subject over time, so frame it as the *subject*, not the news event.

${profileContext ? `USER CONTEXT:\n${profileContext}\n\n` : ""}TRACKER ENTRY METADATA (already decided):
- Short name: ${input.shortName}
- Full name: ${input.fullName}
- Jurisdiction: ${input.jurisdiction}
- Type: ${input.type}
- Category: ${input.category}

SOURCE STORY (your only ground truth — do NOT introduce facts not present here):
Title: ${input.storyTitle}
${input.storyUrl ? `URL: ${input.storyUrl}\n` : ""}Summary: ${input.storySummary}

Draft THREE short fields:

1. **summary** — 2-3 sentences in plain English describing what this legal instrument is or does. Frame it as the durable subject (e.g. "A bill before the Australian parliament that would..."), not as a news event ("Last week, the parliament introduced..."). Acknowledge uncertainty if the source is thin: prefer "appears to" over confident claims you cannot verify from the source. Do NOT invent specific dates, penalties, or section numbers.

2. **whyItMatters** — 1-2 sentences specifically explaining why this is worth tracking, framed through Argus's pass-through-impact lens. Impact = effects flowing to Docusign through TWO pathways:
   (a) **Direct** — Docusign is itself legally obligated.
   (b) **Customer pass-through** — a rule binding Docusign's customers (financial services, healthcare, government, legal) materially alters how they use Docusign. Examples: financial-services outsourcing rules requiring banks to renegotiate vendor contracts; sectoral data-residency mandates forcing new product configurations; third-party risk regimes forcing customer-driven audits or contract terms.
   If the source story doesn't support a strong impact claim, say so plainly ("Direct impact unclear from current reporting; flagged for monitoring.").

3. **impactScore** — integer 1-5 reflecting effect on Docusign through the same two pathways:
   - 5 (Critical) — direct, imminent, binding obligation on Docusign or a near-term customer pass-through requiring action.
   - 4 (High) — significant, well-defined obligation through pathway (a) or (b); should be tracked closely.
   - 3 (Moderate) — relevant operating-environment shift; pass-through plausible but speculative; or applicable guidance with no firm deadline.
   - 2 (Low) — tangential to Docusign; affects edge cases or specific deal types only.
   - 1 (Minimal) — background context, included for completeness.
   Default toward conservative scoring when the source is thin (lower of two plausible scores). Global news significance is NOT impact — only effects flowing to Docusign count.

Constraints:
- All fields must be grounded ONLY in the source story above. If the story is too thin to support a claim, hedge or omit.
- No legal advice, no predictions, no penalty figures unless the story states them verbatim.
- Output MUST be valid JSON in this exact shape, no commentary:
{ "summary": "...", "whyItMatters": "...", "impactScore": 3 }`;

  const response = await anthropic.messages.create({
    model: DRAFT_MODEL,
    max_tokens: 800,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const cleaned = text.replace(/```(?:json)?\s*/g, "").replace(/```\s*$/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < 0) {
    return { summary: "", whyItMatters: "", impactScore: null };
  }
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as Partial<DraftOutput>;
    const rawScore = typeof parsed.impactScore === "number" ? Math.round(parsed.impactScore) : null;
    const impactScore = rawScore !== null && rawScore >= 1 && rawScore <= 5 ? rawScore : null;
    return {
      summary: typeof parsed.summary === "string" ? parsed.summary.trim() : "",
      whyItMatters: typeof parsed.whyItMatters === "string" ? parsed.whyItMatters.trim() : "",
      impactScore,
    };
  } catch {
    return { summary: "", whyItMatters: "", impactScore: null };
  }
}
