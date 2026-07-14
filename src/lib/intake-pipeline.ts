import "server-only";

import { db } from "@/db";
import { entries, intakeCandidates, sourceDocuments } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { generateId, now, toJsonString } from "@/lib/utils";
import { suggestSources } from "@/lib/source-suggester";
import { fetchAndExtract } from "@/lib/source-fetcher";
import { verifySourceMatch } from "@/lib/source-verifier";
import { attachFetchedDocument } from "@/lib/source-attacher";
import { kickOffSummaryGeneration } from "@/lib/summary-pipeline";
import { upgradeSourceUrls } from "@/lib/source-tiers";
import type { SourceTier } from "@/lib/types";

// Intake pipeline (July 2026 redesign) — the background run that follows
// entry creation. Replaces the old flow where a throwaway preliminary analysis
// ran first and the user then manually searched for, judged, and re-analyzed
// against source documents.
//
//   resolve  → pool candidate URLs from capture + the official-registry search
//   verify   → fetch the strong candidates, match-check each against the entry
//   attach   → auto-attach verified official documents (with provenance)
//   analyze  → kick the summary pipeline, which self-selects full vs preliminary
//
// The human gets ONE review moment at the end: the intake panel shows what was
// attached (with evidence), what was rejected (with reasons), and what's held
// for their judgment. Fire-and-forget; status is polled via entries.intakeStatus.

// Tiers the pipeline trusts enough to fetch + verify without being asked.
const OFFICIAL_TIERS: SourceTier[] = ["primary_legislation", "regulator"];
// How many candidates we're willing to fetch + match-check per intake run.
const MAX_VERIFY = 5;

export async function kickOffIntake(entryId: string): Promise<void> {
  const startedAt = now();
  await db
    .update(entries)
    .set({ intakeStatus: "resolving", intakeStartedAt: startedAt, intakeError: null })
    .where(eq(entries.id, entryId));

  void runIntakePipeline(entryId).catch((err) => {
    console.error(`[intake] crashed for ${entryId}:`, err);
  });
}

interface CandidateSeed {
  url: string;
  title: string | null;
  snippet: string | null;
  tier: SourceTier;
  origin: "capture" | "search";
}

export async function runIntakePipeline(entryId: string): Promise<void> {
  try {
    const [row] = await db.select().from(entries).where(eq(entries.id, entryId));
    if (!row) throw new Error(`Entry ${entryId} not found`);

    // ── Resolve: pool candidates from capture + registry search ────────────
    const existingDocUrls = new Set(
      db
        .select({ url: sourceDocuments.sourceUrl })
        .from(sourceDocuments)
        .where(eq(sourceDocuments.entryId, entryId))
        .all()
        .map((r) => normalizeUrl(r.url ?? ""))
        .filter(Boolean)
    );

    const captureSources = upgradeSourceUrls(
      row.sourceUrls ? JSON.parse(row.sourceUrls) : null
    ) ?? [];

    const seeds: CandidateSeed[] = [];
    const seen = new Set<string>();
    for (const s of captureSources) {
      const key = normalizeUrl(s.url);
      if (!key || seen.has(key) || existingDocUrls.has(key)) continue;
      seen.add(key);
      seeds.push({
        url: s.url,
        title: s.label ?? null,
        snippet: null,
        tier: s.tier,
        origin: "capture",
      });
    }

    // Registry/regulator search. Missing EXA_API_KEY or a search failure
    // degrades gracefully — capture URLs alone can still carry the intake.
    try {
      const found = await suggestSources({
        shortName: row.shortName,
        fullName: row.fullName,
        jurisdiction: row.jurisdiction,
        type: row.type,
        regulator: row.regulator,
        category: row.category,
        excludeUrls: [...seen, ...existingDocUrls],
      });
      for (const c of found) {
        const key = normalizeUrl(c.url);
        if (!key || seen.has(key) || existingDocUrls.has(key)) continue;
        seen.add(key);
        seeds.push({
          url: c.url,
          title: c.title,
          snippet: c.snippet,
          tier: c.tier,
          origin: "search",
        });
      }
    } catch (err) {
      console.error(`[intake] source search failed for ${entryId}:`, err);
    }

    const ts = now();
    const candidateIds = new Map<string, string>(); // url → candidate row id
    for (const seed of seeds) {
      const id = generateId();
      candidateIds.set(seed.url, id);
      db.insert(intakeCandidates)
        .values({
          id,
          entryId,
          url: seed.url,
          title: seed.title,
          snippet: seed.snippet,
          tier: seed.tier,
          origin: seed.origin,
          verdict: null,
          evidence: null,
          suggestedRole: null,
          status: "held",
          decidedBy: null,
          documentId: null,
          createdAt: ts,
          updatedAt: ts,
        })
        .run();
    }

    // ── Verify: fetch + match-check the strong candidates ──────────────────
    await db
      .update(entries)
      .set({ intakeStatus: "verifying" })
      .where(eq(entries.id, entryId));

    // Official-tier candidates first (they're what we'd auto-attach), then
    // capture-origin URLs (the extraction model itself cited them). Everything
    // else stays held for the human, judged from title + snippet.
    const verifySet = [
      ...seeds.filter((s) => OFFICIAL_TIERS.includes(s.tier)),
      ...seeds.filter((s) => !OFFICIAL_TIERS.includes(s.tier) && s.origin === "capture"),
    ].slice(0, MAX_VERIFY);

    // Fetch + match-check everything first; attach afterwards. Deferring the
    // attach lets us pick the BEST instrument text rather than the first one —
    // legislation registries serve the same Act under many section-anchor URLs,
    // so first-wins would happily attach a 1-section fragment as primary_text
    // and then file the full compilation as "supporting".
    interface VerifiedHit {
      candidateId: string;
      seedUrl: string;
      fetched: Awaited<ReturnType<typeof fetchAndExtract>>;
      evidence: string;
      suggestedRole: "primary_text" | "supporting";
    }
    const verifiedOfficial: VerifiedHit[] = [];

    for (const seed of verifySet) {
      const candidateId = candidateIds.get(seed.url);
      if (!candidateId) continue;

      const fetched = await fetchAndExtract(seed.url);
      if (!fetched.extracted || !fetched.fullText) {
        updateCandidate(candidateId, {
          verdict: "uncertain",
          evidence: `Could not extract text${fetched.error ? ` — ${fetched.error.slice(0, 160)}` : ""}`,
        });
        continue;
      }

      const check = await verifySourceMatch(
        {
          shortName: row.shortName,
          fullName: row.fullName,
          formalCitation: row.formalCitation,
          jurisdiction: row.jurisdiction,
          type: row.type,
          regulator: row.regulator,
        },
        { url: fetched.url, title: fetched.title, fullText: fetched.fullText }
      );

      if (check.verdict === "verified" && OFFICIAL_TIERS.includes(seed.tier)) {
        verifiedOfficial.push({
          candidateId,
          seedUrl: seed.url,
          fetched,
          evidence: check.evidence,
          suggestedRole: check.suggestedRole,
        });
      } else if (check.verdict === "rejected") {
        updateCandidate(candidateId, {
          verdict: "rejected",
          evidence: check.evidence,
          suggestedRole: check.suggestedRole,
          status: "dismissed",
          decidedBy: "ai",
        });
      } else {
        // Verified-but-unofficial tier, or genuinely uncertain — the human's call.
        updateCandidate(candidateId, {
          verdict: check.verdict,
          evidence: check.evidence,
          suggestedRole: check.suggestedRole,
        });
      }
    }

    // ── Attach: best instrument text as primary, dedupe the rest ───────────
    const attachedUrls: string[] = [];
    const attachedHashes = new Set<string>();
    let attachedCount = 0;

    // Instrument texts (the doc IS the Act): longest extraction wins primary;
    // shorter hits are fragments/duplicates of the same instrument — dismiss
    // them rather than pile near-identical texts onto the entry.
    const instrumentHits = verifiedOfficial
      .filter((h) => h.suggestedRole === "primary_text")
      .sort((a, b) => (b.fetched.fullText?.length ?? 0) - (a.fetched.fullText?.length ?? 0));
    const supportingHits = verifiedOfficial.filter((h) => h.suggestedRole !== "primary_text");

    for (const [i, hit] of instrumentHits.entries()) {
      if (i > 0) {
        updateCandidate(hit.candidateId, {
          verdict: "verified",
          evidence: `${hit.evidence} — duplicate of the attached instrument text (shorter copy of the same document)`,
          suggestedRole: hit.suggestedRole,
          status: "dismissed",
          decidedBy: "ai",
        });
        attachedUrls.push(hit.seedUrl, hit.fetched.url);
        continue;
      }
      const role = hasPrimaryText(entryId) ? "supporting" : "primary_text";
      const attached = await attachFetchedDocument(entryId, hit.fetched, { role });
      updateCandidate(hit.candidateId, {
        verdict: "verified",
        evidence: hit.evidence,
        suggestedRole: hit.suggestedRole,
        status: "attached",
        decidedBy: "ai",
        documentId: attached.documentId,
      });
      if (hit.fetched.contentHash) attachedHashes.add(hit.fetched.contentHash);
      attachedUrls.push(hit.seedUrl, hit.fetched.url);
      attachedCount++;
    }

    for (const hit of supportingHits) {
      if (hit.fetched.contentHash && attachedHashes.has(hit.fetched.contentHash)) {
        updateCandidate(hit.candidateId, {
          verdict: "verified",
          evidence: `${hit.evidence} — identical to an already-attached document`,
          suggestedRole: hit.suggestedRole,
          status: "dismissed",
          decidedBy: "ai",
        });
        attachedUrls.push(hit.seedUrl, hit.fetched.url);
        continue;
      }
      const attached = await attachFetchedDocument(entryId, hit.fetched, { role: "supporting" });
      updateCandidate(hit.candidateId, {
        verdict: "verified",
        evidence: hit.evidence,
        suggestedRole: hit.suggestedRole,
        status: "attached",
        decidedBy: "ai",
        documentId: attached.documentId,
      });
      if (hit.fetched.contentHash) attachedHashes.add(hit.fetched.contentHash);
      attachedUrls.push(hit.seedUrl, hit.fetched.url);
      attachedCount++;
    }

    // Attached URLs stop being "unresolved leads" on the entry.
    if (attachedUrls.length > 0 && captureSources.length > 0) {
      const attachedSet = new Set(attachedUrls.map(normalizeUrl));
      const remaining = captureSources.filter((s) => !attachedSet.has(normalizeUrl(s.url)));
      await db
        .update(entries)
        .set({
          sourceUrls: remaining.length > 0 ? toJsonString(remaining) : null,
          updatedAt: now(),
        })
        .where(eq(entries.id, entryId));
    }

    // ── Analyze: summary pipeline self-selects full vs preliminary ─────────
    // With attached docs this is the full grounded analysis (the whole point).
    // With nothing attached, only run the preliminary sketch when the entry
    // doesn't already have a capture-drafted summary to show.
    if (attachedCount > 0 || !row.summary) {
      await kickOffSummaryGeneration(entryId);
    }

    await db
      .update(entries)
      .set({ intakeStatus: "done", intakeError: null })
      .where(eq(entries.id, entryId));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[intake] failed for ${entryId}:`, err);
    await db
      .update(entries)
      .set({ intakeStatus: "failed", intakeError: message.slice(0, 2000) })
      .where(eq(entries.id, entryId));
  }
}

function updateCandidate(
  id: string,
  fields: Partial<{
    verdict: string;
    evidence: string;
    suggestedRole: string;
    status: string;
    decidedBy: string;
    documentId: string | null;
  }>
) {
  db.update(intakeCandidates)
    .set({ ...fields, updatedAt: now() })
    .where(eq(intakeCandidates.id, id))
    .run();
}

function hasPrimaryText(entryId: string): boolean {
  const row = db
    .select({ id: sourceDocuments.id })
    .from(sourceDocuments)
    .where(and(eq(sourceDocuments.entryId, entryId), eq(sourceDocuments.role, "primary_text")))
    .get();
  return !!row;
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return url;
  }
}
