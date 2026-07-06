import "server-only";

import { db } from "@/db";
import { entries, sourceDocuments, definedTerms, entryRelationships } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { logChanges } from "@/lib/entry-helpers";
import { now, toJsonString } from "@/lib/utils";
import { generateEntrySummary, generatePreliminarySummary } from "@/lib/summary-ai";
import type { SummaryDepth } from "@/lib/types";
import { logAgentRun } from "@/lib/agent-runs";
import { refreshSourceDocument } from "@/lib/source-refresher";

// Background-job pipeline for the entry-summary workflow. Lifted out of the
// /generate-summary route so creation paths (manual create, capture, ingest,
// from-reference, gap suggestion) can also kick off a preliminary analysis
// for a brand-new entry without going through HTTP.
//
// The pipeline auto-detects which mode to run: with source docs attached it
// runs the full 4-stage adversarial pipeline (5–15 min); without docs it
// runs a single-shot preliminary sketch (~30–90s). Both fire-and-forget;
// callers don't await runSummaryPipeline.

export type KickoffResult =
  | { status: "running"; startedAt: string }
  | { status: "already_running"; startedAt: string | null };

// Set summaryStatus='running' and fire off the pipeline as a background
// promise. Returns immediately. If a generation is already in flight for
// this entry, returns { status: "already_running" } and does not kick off
// another run.
export async function kickOffSummaryGeneration(id: string): Promise<KickoffResult> {
  const [row] = await db.select().from(entries).where(eq(entries.id, id));
  if (!row) {
    throw new Error(`Entry ${id} not found`);
  }

  if (row.summaryStatus === "running") {
    return { status: "already_running", startedAt: row.summaryStartedAt };
  }

  const startedAt = now();
  await db
    .update(entries)
    .set({
      summaryStatus: "running",
      summaryStartedAt: startedAt,
      summaryError: null,
    })
    .where(eq(entries.id, id));

  // Fire and forget. We do NOT await — the caller returns to the user
  // immediately, and the pipeline keeps running server-side. Errors are
  // caught and written to summary_error so the UI can surface them when
  // polling.
  void runSummaryPipeline(id).catch((err) => {
    console.error(`[summary-pipeline] crashed for ${id}:`, err);
  });

  return { status: "running", startedAt };
}

export async function runSummaryPipeline(id: string) {
  try {
    const [row] = await db.select().from(entries).where(eq(entries.id, id));
    if (!row) {
      throw new Error(`Entry ${id} disappeared after status flip`);
    }

    let docs = await db
      .select()
      .from(sourceDocuments)
      .where(eq(sourceDocuments.entryId, id));

    // Heal any URL-only docs (full_text missing) by refetching with the
    // current fetcher chain. This covers two cases:
    //   1. Docs added before the direct-fetch fallback existed (legacy).
    //   2. Docs whose original Exa fetch silently produced no text.
    // Without this step, "Run full analysis" silently degrades to
    // preliminary mode whenever any doc fetch failed previously.
    const needsRefetch = docs.filter(
      (d) => !d.fullText && d.sourceUrl && d.fetchStatus !== "manual"
    );
    if (needsRefetch.length > 0) {
      console.log(
        `[summary-pipeline] refetching ${needsRefetch.length} URL-only doc(s) for ${id}`
      );
      await Promise.all(
        needsRefetch.map((d) =>
          refreshSourceDocument(d.id).catch((err) =>
            console.error(`[summary-pipeline] refetch failed for ${d.id}:`, err)
          )
        )
      );
      docs = await db
        .select()
        .from(sourceDocuments)
        .where(eq(sourceDocuments.entryId, id));
    }

    const groundedDocs = docs
      .filter((d) => d.fullText)
      .map((d) => ({
        id: d.id,
        name: d.name,
        sourceUrl: d.sourceUrl,
        fullText: d.fullText as string,
        sourceAuthority: d.sourceAuthority,
      }));

    // A2 — amendment context. When this instrument has its own grounded text,
    // also feed in source documents from entries that amend it, labelled so the
    // model treats them as amending instruments rather than the principal. Only
    // augments a genuine full analysis (skip when the principal is ungrounded —
    // an amendment alone shouldn't masquerade as grounding the principal).
    if (groundedDocs.length > 0) {
      const amendingRels = await db
        .select({ fromEntryId: entryRelationships.fromEntryId })
        .from(entryRelationships)
        .where(and(eq(entryRelationships.toEntryId, id), eq(entryRelationships.kind, "amends")));
      const amendingIds = amendingRels.map((r) => r.fromEntryId);
      if (amendingIds.length > 0) {
        const amendingEntries = await db
          .select({ id: entries.id, shortName: entries.shortName })
          .from(entries)
          .where(inArray(entries.id, amendingIds));
        const nameById = new Map(amendingEntries.map((e) => [e.id, e.shortName]));
        const amendingDocs = await db
          .select()
          .from(sourceDocuments)
          .where(inArray(sourceDocuments.entryId, amendingIds));
        for (const d of amendingDocs) {
          if (!d.fullText) continue;
          groundedDocs.push({
            id: d.id,
            name: `[Amending instrument — ${nameById.get(d.entryId) ?? "amendment"}] ${d.name}`,
            sourceUrl: d.sourceUrl,
            fullText: d.fullText as string,
            sourceAuthority: d.sourceAuthority,
          });
        }
      }
    }

    // If the entry has docs attached but every fetch attempt produced no
    // text, fail loudly instead of silently degrading to preliminary. The
    // user explicitly asked for full analysis and deserves to know why it
    // can't run.
    const hasAttachedDocs = docs.length > 0;
    if (hasAttachedDocs && groundedDocs.length === 0) {
      const failures = docs
        .filter((d) => d.fetchStatus && d.fetchStatus !== "ok")
        .map((d) => `${d.name}: ${d.fetchError ?? d.fetchStatus}`)
        .join("; ");
      throw new Error(
        `All ${docs.length} attached source document${
          docs.length === 1 ? "" : "s"
        } have no extracted text. Paste the text manually or replace the URL. ${
          failures ? `Details: ${failures}` : ""
        }`.trim()
      );
    }

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

    const allEntries = await db
      .select()
      .from(entries)
      .where(eq(entries.archived, false));

    const relatedEntryNames = allEntries
      .filter((e) => e.shortName !== row.shortName)
      .map((e) => `${e.shortName} (${e.jurisdiction}, ${e.category})`);

    const COMPARATOR_LIMIT = 5;
    const comparators = allEntries
      .filter((e) =>
        e.id !== row.id &&
        e.category === row.category &&
        e.jurisdiction !== row.jurisdiction
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

    const relatedIds = row.relatedEntries
      ? (JSON.parse(row.relatedEntries) as string[])
      : [];
    if (relatedIds.length > 0) {
      const includedIds = new Set(comparators.map((c) => c.shortName));
      for (const relId of relatedIds) {
        const rel = allEntries.find((e) => e.id === relId);
        if (rel && !includedIds.has(rel.shortName)) {
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

    const keyDates = row.keyDates
      ? (JSON.parse(row.keyDates) as { date: string; label: string }[])
      : undefined;

    // Branch on source-doc presence. With docs: full 4-stage adversarial
    // pipeline. Without docs: single-shot preliminary sketch.
    const summaryDepth: SummaryDepth = groundedDocs.length === 0 ? "preliminary" : "full";
    const generated = summaryDepth === "preliminary"
      ? await generatePreliminarySummary({
          shortName: row.shortName,
          fullName: row.fullName,
          jurisdiction: row.jurisdiction,
          category: row.category,
          type: row.type,
          status: row.status,
          regulator: row.regulator,
          existingSummary: row.summary,
          existingNotes: row.notes,
          sourceDocuments: groundedDocs,
          definedTerms: termsForPrompt,
          comparators,
          currentDate: new Date().toISOString().slice(0, 10),
          keyDates,
          relatedEntryNames,
        })
      : await generateEntrySummary({
          shortName: row.shortName,
          fullName: row.fullName,
          jurisdiction: row.jurisdiction,
          category: row.category,
          type: row.type,
          status: row.status,
          regulator: row.regulator,
          existingSummary: row.summary,
          existingNotes: row.notes,
          sourceDocuments: groundedDocs,
          definedTerms: termsForPrompt,
          comparators,
          currentDate: new Date().toISOString().slice(0, 10),
          keyDates,
          relatedEntryNames,
        });

    const timestamp = now();
    const updates: Record<string, unknown> = {
      summary: generated.summary,
      applicability: generated.applicability,
      keyCriteria: generated.keyCriteria,
      whyItMatters: generated.whyItMatters,
      complianceImplications: generated.complianceImplications,
      exemptions: generated.exemptions,
      penalties: generated.penalties ?? null,
      openQuestions: generated.openQuestions ?? null,
      aiGenerated: true,
      summaryDepth,
      updatedAt: timestamp,
      summaryStatus: "idle",
      summaryError: null,
    };

    // A full, source-grounded regeneration incorporates any amendment context
    // gathered above, so it clears the "analysis predates amendment" flag. A
    // preliminary regen doesn't (it saw no source text), so leave it set.
    if (summaryDepth === "full") {
      updates.analysisStaleReason = null;
    }

    // Only overwrite formalCitation when the model produced one — preserves
    // any analyst-edited citation across regenerations.
    if (generated.formalCitation) {
      updates.formalCitation = generated.formalCitation;
    }

    // Same preservation rule for the dual impact lenses: a null from the
    // model must not wipe an analyst-written lens.
    if (generated.impactOnUs) {
      updates.impactOnUs = generated.impactOnUs;
    }
    if (generated.impactOnCustomers) {
      updates.impactOnCustomers = generated.impactOnCustomers;
    }

    if (generated.sectionConfidence) {
      updates.sectionConfidence = toJsonString(generated.sectionConfidence);
    }
    if (generated.sectionClaims) {
      updates.sectionClaims = toJsonString(generated.sectionClaims);
    }

    // Practitioner outputs (escalationTriggers, complianceChecklist,
    // thresholdTests) and cross-jurisdiction analogues (relatedContext) are
    // produced separately on demand via /generate-artifact.

    await logChanges(id, row, updates, "ai");
    await db.update(entries).set(updates).where(eq(entries.id, id));

    await logAgentRun({
      workflow: "summary",
      modelUsed: "claude-sonnet-4-6",
      entriesUpdated: 1,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[summary-pipeline] failed for ${id}:`, err);
    await db
      .update(entries)
      .set({
        summaryStatus: "failed",
        summaryError: message.slice(0, 2000),
      })
      .where(eq(entries.id, id));
  }
}
