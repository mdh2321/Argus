import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { entries, sourceDocuments, definedTerms } from "@/db/schema";
import { eq } from "drizzle-orm";
import { logChanges } from "@/lib/entry-helpers";
import { now, parseJsonField, toJsonString } from "@/lib/utils";
import { generateArtifact, type CrossJurisdictionResult } from "@/lib/artifact-ai";
import type {
  AnalysisJobs,
  ArtifactKind,
  ArtifactJobState,
  ComplianceChecklistItem,
  EntryClaim,
  EntrySectionClaims,
  EntrySectionConfidence,
  EscalationTrigger,
  ThresholdTest,
} from "@/lib/types";
import { logAgentRun } from "@/lib/agent-runs";

export const maxDuration = 600;

const ARTIFACT_KINDS: readonly ArtifactKind[] = [
  "complianceChecklist",
  "thresholdTests",
  "escalationTriggers",
  "crossJurisdictionAnalogues",
];

// Same fire-and-forget shape as /generate-summary. The route returns 202
// immediately after marking the artifact's job as 'running'; the actual model
// call runs in the background and writes the result + flips status when
// done. The UI polls the entry's analysisJobs[kind] field.
//
// One route handles all artifact kinds — the only difference per kind is the
// generator function and which entry column the result lands in. Both are
// keyed off the `kind` parameter so adding a new artifact later is just a
// matter of extending ArtifactKind + the generator's switch.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let body: { kind?: unknown };
  try {
    body = (await request.json()) as { kind?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const kind = body.kind;
  if (!isArtifactKind(kind)) {
    return NextResponse.json(
      {
        error: "Invalid kind",
        detail: `Expected one of: ${ARTIFACT_KINDS.join(", ")}`,
      },
      { status: 400 }
    );
  }

  const [row] = await db.select().from(entries).where(eq(entries.id, id));
  if (!row) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  }

  const jobs: AnalysisJobs = parseJsonField<AnalysisJobs>(row.analysisJobs) ?? {};
  const existing = jobs[kind];
  if (existing?.status === "running") {
    return NextResponse.json(
      {
        status: "running",
        startedAt: existing.startedAt,
        message: `${kind} generation is already in progress for this entry.`,
      },
      { status: 409 }
    );
  }

  const startedAt = now();
  const nextJobs: AnalysisJobs = {
    ...jobs,
    [kind]: { status: "running", startedAt, error: null } satisfies ArtifactJobState,
  };
  await db
    .update(entries)
    .set({ analysisJobs: toJsonString(nextJobs) })
    .where(eq(entries.id, id));

  void runArtifactPipeline(id, kind).catch((err) => {
    console.error(`[generate-artifact:${kind}] pipeline crashed for ${id}:`, err);
  });

  return NextResponse.json({ status: "running", startedAt }, { status: 202 });
}

function isArtifactKind(value: unknown): value is ArtifactKind {
  return typeof value === "string" && (ARTIFACT_KINDS as readonly string[]).includes(value);
}

async function runArtifactPipeline(id: string, kind: ArtifactKind) {
  try {
    const [row] = await db.select().from(entries).where(eq(entries.id, id));
    if (!row) {
      throw new Error(`Entry ${id} disappeared after status flip`);
    }

    const docs = await db
      .select()
      .from(sourceDocuments)
      .where(eq(sourceDocuments.entryId, id));

    const groundedDocs = docs
      .filter((d) => d.fullText)
      .map((d) => ({
        id: d.id,
        name: d.name,
        sourceUrl: d.sourceUrl,
        fullText: d.fullText as string,
        sourceAuthority: d.sourceAuthority,
      }));

    const termRows = await db
      .select()
      .from(definedTerms)
      .where(eq(definedTerms.entryId, id));
    const termsForPrompt = termRows.map((t) => ({
      term: t.term,
      definition: t.definition,
      sectionRef: t.sectionRef,
      scope: t.scope,
      sourceDocId: t.sourceDocId,
    }));

    // Comparators: only built for the cross-jurisdiction artifact, since the
    // other three don't benefit from cross-jurisdictional context.
    const comparators =
      kind === "crossJurisdictionAnalogues"
        ? await buildComparators(row.id, row.category, row.jurisdiction, row.relatedEntries)
        : undefined;

    const keyDates = row.keyDates
      ? (JSON.parse(row.keyDates) as { date: string; label: string }[])
      : undefined;

    const result = await generateArtifact(kind, {
      shortName: row.shortName,
      fullName: row.fullName,
      jurisdiction: row.jurisdiction,
      category: row.category,
      type: row.type,
      status: row.status,
      regulator: row.regulator,
      existingSummary: row.summary,
      existingApplicability: row.applicability,
      existingKeyCriteria: row.keyCriteria,
      existingWhyItMatters: row.whyItMatters,
      existingComplianceImplications: row.complianceImplications,
      existingExemptions: row.exemptions,
      existingPenalties: row.penalties,
      sourceDocuments: groundedDocs,
      definedTerms: termsForPrompt,
      comparators,
      currentDate: new Date().toISOString().slice(0, 10),
      keyDates,
    });

    const updates = buildArtifactUpdates(kind, result, row);
    const timestamp = now();
    updates.updatedAt = timestamp;

    // Mark this artifact's job idle so the UI stops showing the spinner.
    const refreshedJobs: AnalysisJobs =
      parseJsonField<AnalysisJobs>(row.analysisJobs) ?? {};
    refreshedJobs[kind] = { status: "idle", startedAt: null, error: null };
    updates.analysisJobs = toJsonString(refreshedJobs);

    await logChanges(id, row, updates, "ai");
    await db.update(entries).set(updates).where(eq(entries.id, id));

    await logAgentRun({
      workflow: `artifact:${kind}`,
      modelUsed: "claude-sonnet-4-6",
      entriesUpdated: 1,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[generate-artifact:${kind}] failed for ${id}:`, err);

    // Re-read the entry's jobs in case another artifact's status changed
    // while this one was running.
    const [row] = await db.select().from(entries).where(eq(entries.id, id));
    if (!row) return;
    const failedJobs: AnalysisJobs =
      parseJsonField<AnalysisJobs>(row.analysisJobs) ?? {};
    failedJobs[kind] = {
      status: "failed",
      startedAt: failedJobs[kind]?.startedAt ?? null,
      error: message.slice(0, 2000),
    };
    await db
      .update(entries)
      .set({ analysisJobs: toJsonString(failedJobs) })
      .where(eq(entries.id, id));
  }
}

// Kind-specific landing logic — which entry column receives the result, plus
// any auxiliary writes (claims, confidence) for artifacts that ride on the
// existing sectionClaims / sectionConfidence machinery.
function buildArtifactUpdates(
  kind: ArtifactKind,
  result: unknown,
  row: typeof entries.$inferSelect
): Record<string, unknown> {
  const updates: Record<string, unknown> = {};

  switch (kind) {
    case "complianceChecklist": {
      const items = result as ComplianceChecklistItem[];
      updates.complianceChecklist = items.length > 0 ? toJsonString(items) : null;
      return updates;
    }

    case "thresholdTests": {
      const items = result as ThresholdTest[];
      updates.thresholdTests = items.length > 0 ? toJsonString(items) : null;
      return updates;
    }

    case "escalationTriggers": {
      const items = result as EscalationTrigger[];
      updates.escalationTriggers = items.length > 0 ? toJsonString(items) : null;
      return updates;
    }

    case "crossJurisdictionAnalogues": {
      const r = result as CrossJurisdictionResult;
      updates.relatedContext = r.text;

      const existingClaims =
        parseJsonField<EntrySectionClaims>(row.sectionClaims) ?? {};
      const nextClaims: EntrySectionClaims = { ...existingClaims };
      if (r.claims.length > 0) {
        nextClaims.relatedContext = r.claims as EntryClaim[];
      } else {
        delete nextClaims.relatedContext;
      }
      updates.sectionClaims = Object.keys(nextClaims).length > 0
        ? toJsonString(nextClaims)
        : null;

      const existingConfidence =
        parseJsonField<EntrySectionConfidence>(row.sectionConfidence) ?? {};
      const nextConfidence: EntrySectionConfidence = { ...existingConfidence };
      if (r.confidence) {
        nextConfidence.relatedContext = r.confidence;
      } else {
        delete nextConfidence.relatedContext;
      }
      updates.sectionConfidence = Object.keys(nextConfidence).length > 0
        ? toJsonString(nextConfidence)
        : null;

      return updates;
    }
  }
}

// Lifted from generate-summary route — same comparator selection logic
// (5 same-category-different-jurisdiction entries plus any explicitly
// related ones). Kept inline rather than refactored into a shared helper
// because the summary pipeline computes a few extra context bits we don't
// need here, and pulling apart that route felt riskier than copying ~50
// lines.
async function buildComparators(
  rowId: string,
  category: string,
  jurisdiction: string,
  relatedEntriesJson: string | null
) {
  const COMPARATOR_LIMIT = 5;
  const allEntries = await db
    .select()
    .from(entries)
    .where(eq(entries.archived, false));

  const comparators = allEntries
    .filter(
      (e) =>
        e.id !== rowId &&
        e.category === category &&
        e.jurisdiction !== jurisdiction
    )
    .sort((a, b) => a.jurisdiction.localeCompare(b.jurisdiction))
    .slice(0, COMPARATOR_LIMIT)
    .map((e) => ({
      shortName: e.shortName,
      fullName: e.fullName,
      jurisdiction: e.jurisdiction,
      category: e.category,
      status: e.status,
      regulator: e.regulator,
      summary: e.summary,
      keyCriteria: e.keyCriteria,
      penalties: e.penalties,
      relation: "Same category, different jurisdiction",
    }));

  const relatedIds = relatedEntriesJson
    ? (JSON.parse(relatedEntriesJson) as string[])
    : [];
  if (relatedIds.length > 0) {
    const includedNames = new Set(comparators.map((c) => c.shortName));
    for (const relId of relatedIds) {
      const rel = allEntries.find((e) => e.id === relId);
      if (rel && !includedNames.has(rel.shortName)) {
        comparators.push({
          shortName: rel.shortName,
          fullName: rel.fullName,
          jurisdiction: rel.jurisdiction,
          category: rel.category,
          status: rel.status,
          regulator: rel.regulator,
          summary: rel.summary,
          keyCriteria: rel.keyCriteria,
          penalties: rel.penalties,
          relation: "Explicitly related entry",
        });
      }
    }
  }

  return comparators;
}
