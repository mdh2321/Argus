import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/db";
import { entries, sourceDocuments, knowledgeItems, knowledgeClaims, digestIssues, digestStories } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { generateId, now, toJsonString } from "@/lib/utils";
import { serializeEntry } from "@/lib/entry-helpers";
import { getProfileContext } from "@/lib/profile-context";
import { createHash } from "crypto";
import type {
  KnowledgeItemType,
  KnowledgeConfidence,
  KnowledgeGrounding,
  GroundingType,
  BriefingContent,
  BriefingSection,
  KnowledgeItem,
} from "@/lib/types";

const client = new Anthropic();
const MODEL = "claude-sonnet-4-6";

// Per-document char cap. Knowledge items pull source text from many entries at
// once, so cap each doc at ~100K tokens (~400K chars). With prompt caching the
// source-docs prefix is reused across draft / critique / reconcile passes, so
// a much larger budget is affordable than the previous 30K.
const MAX_DOC_CHARS = 400000;
const DOC_SLICE_VERIFY = 100000;

// Prompt hash for staleness tracking when prompts change
function hashPrompt(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex").slice(0, 16);
}

// --- Multi-stage analysis pipeline ---
//
// Wraps a single draft prompt with two follow-up passes:
//   1. Draft (with adaptive thinking)
//   2. Adversarial critique (devil's advocate)
//   3. Reconciliation (revised draft addressing the critique)
// If the critique finds nothing, we skip the reconcile pass and return the
// draft as-is.

interface CritiqueIssue {
  section: string;
  severity: "high" | "medium" | "low";
  problem: string;
  suggestedFix: string;
}

interface CritiqueResponse {
  overallAssessment: string;
  missedIssues: CritiqueIssue[];
  weakClaims: CritiqueIssue[];
  counterReadings: CritiqueIssue[];
  jurisdictionalConcerns: CritiqueIssue[];
}

function extractText(response: Anthropic.Message): string {
  const block = response.content.find((b) => b.type === "text");
  return block?.type === "text" ? block.text : "";
}

function cleanJson(text: string): string {
  return text.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
}

function parseCritique(text: string): CritiqueResponse {
  let parsed: Partial<CritiqueResponse> = {};
  try {
    parsed = JSON.parse(text) as Partial<CritiqueResponse>;
  } catch {
    parsed = {};
  }
  return {
    overallAssessment: typeof parsed.overallAssessment === "string" ? parsed.overallAssessment : "",
    missedIssues: Array.isArray(parsed.missedIssues) ? parsed.missedIssues : [],
    weakClaims: Array.isArray(parsed.weakClaims) ? parsed.weakClaims : [],
    counterReadings: Array.isArray(parsed.counterReadings) ? parsed.counterReadings : [],
    jurisdictionalConcerns: Array.isArray(parsed.jurisdictionalConcerns) ? parsed.jurisdictionalConcerns : [],
  };
}

// A prompt that may have a cacheable sources prefix. When `sources` is
// non-empty, the request is sent as a multi-block user message with a
// cache_control marker on the sources block — so subsequent stages within the
// same pipeline pay ~0.1x for those tokens.
type CachedPrompt = { sources: string; instructions: string };

async function callCached(opts: {
  prompt: CachedPrompt;
  maxTokens: number;
  thinking?: boolean;
}): Promise<Anthropic.Message> {
  const content = opts.prompt.sources
    ? [
        {
          type: "text" as const,
          text: opts.prompt.sources,
          cache_control: { type: "ephemeral" as const },
        },
        { type: "text" as const, text: opts.prompt.instructions },
      ]
    : opts.prompt.instructions;

  return client.messages.create({
    model: MODEL,
    max_tokens: opts.maxTokens,
    ...(opts.thinking ? { thinking: { type: "adaptive" as const } } : {}),
    messages: [{ role: "user", content }],
  });
}

async function runMultiStageReview<T>(opts: {
  draft: CachedPrompt;
  buildCritique: (draftJson: string) => CachedPrompt;
  buildReconcile: (draftJson: string, critiqueJson: string) => CachedPrompt;
}): Promise<{ result: T; rawText: string }> {
  // Stage 1: draft with adaptive thinking.
  const draftResp = await callCached({
    prompt: opts.draft,
    maxTokens: 16000,
    thinking: true,
  });
  const draftText = cleanJson(extractText(draftResp));
  const draft = JSON.parse(draftText) as T;

  // Stage 2: adversarial critique.
  const critiqueResp = await callCached({
    prompt: opts.buildCritique(JSON.stringify(draft, null, 2)),
    maxTokens: 12000,
    thinking: true,
  });
  const critique = parseCritique(cleanJson(extractText(critiqueResp)));

  const totalIssues =
    critique.missedIssues.length +
    critique.weakClaims.length +
    critique.counterReadings.length +
    critique.jurisdictionalConcerns.length;

  if (totalIssues === 0) {
    return { result: draft, rawText: draftText };
  }

  // Stage 3: reconcile draft with critique.
  const reconcileResp = await callCached({
    prompt: opts.buildReconcile(
      JSON.stringify(draft, null, 2),
      JSON.stringify(critique, null, 2)
    ),
    maxTokens: 16000,
    thinking: true,
  });
  const finalText = cleanJson(extractText(reconcileResp));
  const finalResult = JSON.parse(finalText) as T;
  return { result: finalResult, rawText: finalText };
}

// --- Citation verification for knowledge claims ---
//
// For each claim with groundingType `direct_quote` or `paraphrase` AND a
// sourceEntryId, ask the model to verify the claim against that entry's
// source documents. Downgrade unsupported claims to `inference` /
// `ai_knowledge` and annotate sourceSection with verification notes.

type AIClaim = {
  text: string;
  sourceEntryId?: string;
  sourceSection?: string;
  groundingType: GroundingType;
  confidence: KnowledgeConfidence;
};

async function verifyKnowledgeClaims(
  claims: AIClaim[],
  docs: (typeof sourceDocuments.$inferSelect)[]
): Promise<AIClaim[]> {
  if (claims.length === 0 || docs.length === 0) return claims;

  // Group docs by entryId for fast lookup.
  const docsByEntry = new Map<string, (typeof sourceDocuments.$inferSelect)[]>();
  for (const doc of docs) {
    if (!doc.fullText) continue;
    const list = docsByEntry.get(doc.entryId) ?? [];
    list.push(doc);
    docsByEntry.set(doc.entryId, list);
  }

  // Bucket verifiable claims by entry.
  const verifiable: { idx: number; claim: AIClaim; entryDocs: (typeof sourceDocuments.$inferSelect)[] }[] = [];
  claims.forEach((claim, idx) => {
    if (claim.groundingType !== "direct_quote" && claim.groundingType !== "paraphrase") return;
    if (!claim.sourceEntryId) return;
    const entryDocs = docsByEntry.get(claim.sourceEntryId);
    if (!entryDocs || entryDocs.length === 0) return;
    verifiable.push({ idx, claim, entryDocs });
  });

  if (verifiable.length === 0) return claims;

  // Group by entryId so each verification call covers all claims for that entry.
  const byEntry = new Map<string, typeof verifiable>();
  for (const v of verifiable) {
    const entryId = v.claim.sourceEntryId!;
    const list = byEntry.get(entryId) ?? [];
    list.push(v);
    byEntry.set(entryId, list);
  }

  const results = new Map<number, { status: string; evidence: string | null; reasoning: string | null }>();

  await Promise.all(
    Array.from(byEntry.entries()).map(async ([, group]) => {
      const entryDocs = group[0].entryDocs;
      const docText = entryDocs
        .map((d, i) => `--- Doc ${i + 1}: ${d.name} ---\n${d.fullText!.slice(0, DOC_SLICE_VERIFY)}`)
        .join("\n\n");

      const claimList = group
        .map(
          (v, i) =>
            `[${i + 1}] section: "${v.claim.sourceSection ?? "(none)"}" — claim: "${v.claim.text}"`
        )
        .join("\n");

      const prompt = `You are verifying citations in a legal knowledge page. For each claim below, locate the supporting passage in the source documents and decide whether the claim is genuinely supported.

SOURCE DOCUMENTS:
${docText}

CLAIMS TO VERIFY:
${claimList}

For each claim, decide:
- "verified" — the source clearly supports the claim
- "partial" — the source partially supports it or the claim overstates the source
- "unsupported" — the source does not support the claim
- "not_found" — the cited section/passage could not be located in the document text provided (which may be truncated)

Quote the most relevant source sentence (max 200 chars) when status is "verified" or "partial".

Return ONLY valid JSON in this shape:
{
  "results": [
    { "claimNumber": 1, "status": "verified", "evidence": "<verbatim quote or null>", "reasoning": "<short>" }
  ]
}`;

      try {
        const resp = await client.messages.create({
          model: MODEL,
          max_tokens: 8000,
          messages: [{ role: "user", content: prompt }],
        });
        const text = cleanJson(extractText(resp));
        const parsed = JSON.parse(text) as {
          results?: Array<{ claimNumber?: number; status?: string; evidence?: string | null; reasoning?: string | null }>;
        };
        const items = Array.isArray(parsed.results) ? parsed.results : [];
        group.forEach((v, i) => {
          const r = items.find((x) => x.claimNumber === i + 1) ?? items[i];
          results.set(v.idx, {
            status: typeof r?.status === "string" ? r.status : "not_found",
            evidence: typeof r?.evidence === "string" ? r.evidence : null,
            reasoning: typeof r?.reasoning === "string" ? r.reasoning : null,
          });
        });
      } catch {
        group.forEach((v) => {
          results.set(v.idx, { status: "not_found", evidence: null, reasoning: "Verification call failed." });
        });
      }
    })
  );

  return claims.map((claim, idx) => {
    const r = results.get(idx);
    if (!r) return claim;
    switch (r.status) {
      case "verified":
        return {
          ...claim,
          sourceSection: r.evidence
            ? `${claim.sourceSection ?? ""}${claim.sourceSection ? " | " : ""}Verified: "${truncate(r.evidence, 160)}"`.trim()
            : claim.sourceSection,
        };
      case "partial":
        return {
          ...claim,
          groundingType: "inference",
          confidence: claim.confidence === "high" ? "medium" : claim.confidence,
          sourceSection: r.evidence
            ? `${claim.sourceSection ?? ""}${claim.sourceSection ? " | " : ""}Partial support: "${truncate(r.evidence, 160)}"`.trim()
            : claim.sourceSection,
        };
      case "unsupported":
        return {
          ...claim,
          groundingType: "ai_knowledge",
          confidence: "low",
          sourceSection: `Cited source did not support this claim. ${r.reasoning ?? ""}`.trim(),
        };
      case "not_found":
      default:
        return {
          ...claim,
          sourceSection: claim.sourceSection
            ? `${claim.sourceSection} | (citation not verified)`
            : "(citation not verified)",
        };
    }
  });
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

// --- Slug generation ---

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

// --- Generate a knowledge item ---

interface GenerateKnowledgeInput {
  title: string;
  itemType: KnowledgeItemType;
  jurisdiction?: string | null;
  category?: string | null;
  entryIds?: string[];
  customInstructions?: string;
  periodFrom?: string;
  periodTo?: string;
}

interface AIKnowledgeOutput {
  content: string;
  claims: {
    text: string;
    sourceEntryId?: string;
    sourceSection?: string;
    groundingType: GroundingType;
    confidence: KnowledgeConfidence;
  }[];
  suggestedRelatedEntryIds: string[];
}

export async function generateKnowledgeItem(
  input: GenerateKnowledgeInput
): Promise<KnowledgeItem> {
  // Gather source entries
  const entryRows = input.entryIds?.length
    ? await db.select().from(entries).where(inArray(entries.id, input.entryIds))
    : await db.select().from(entries).where(eq(entries.archived, false));

  const relevantEntries = input.entryIds?.length
    ? entryRows
    : filterRelevantEntries(entryRows, input);

  const serialized = relevantEntries.map(serializeEntry);

  // Gather source documents for those entries
  const entryIdList = relevantEntries.map((e) => e.id);
  const docs = entryIdList.length
    ? await db.select().from(sourceDocuments).where(inArray(sourceDocuments.entryId, entryIdList))
    : [];

  // Gather relevant digest stories
  const digestContext = await gatherDigestContext(input);

  // Build the prompt
  const profileContext = await getProfileContext();
  const draftPrompt = buildKnowledgePrompt(input, serialized, docs, digestContext, profileContext);
  // promptHash captures the full intended prompt (sources + instructions) so
  // edits to either side properly invalidate downstream knowledge items.
  const promptHash = hashPrompt(`${draftPrompt.sources}\n${draftPrompt.instructions}`);

  // Stage 1-3: draft → adversarial critique → reconcile.
  const { result: rawParsed } = await runMultiStageReview<AIKnowledgeOutput>({
    draft: draftPrompt,
    buildCritique: (draftJson) =>
      buildKnowledgeCritiquePrompt(input, draftJson, serialized, docs, profileContext),
    buildReconcile: (draftJson, critiqueJson) =>
      buildKnowledgeReconcilePrompt(input, draftJson, critiqueJson, serialized, docs, profileContext),
  });

  // Stage 4: verify each grounded claim against its source documents.
  const verifiedClaims = await verifyKnowledgeClaims(rawParsed.claims, docs);
  const parsed: AIKnowledgeOutput = {
    content: rawParsed.content,
    claims: verifiedClaims,
    suggestedRelatedEntryIds: rawParsed.suggestedRelatedEntryIds ?? [],
  };

  // Compute trust metrics
  const totalClaims = parsed.claims.length;
  const groundedClaims = parsed.claims.filter(
    (c) => c.groundingType !== "ai_knowledge"
  ).length;
  const groundingRatio = totalClaims > 0 ? groundedClaims / totalClaims : 0;

  // Determine confidence
  const confidence = computeConfidence(groundingRatio, docs, parsed.claims);
  const groundedIn = computeGrounding(groundingRatio, docs.length);

  // Determine source doc IDs used
  const sourceDocIds = docs.map((d) => d.id);

  const timestamp = now();
  const slug = slugify(input.title);
  const id = generateId();

  // Insert knowledge item
  await db.insert(knowledgeItems).values({
    id,
    slug,
    title: input.title,
    itemType: input.itemType,
    jurisdiction: input.jurisdiction || null,
    category: input.category || null,
    content: parsed.content,
    contentHtml: null,
    confidence,
    groundedIn,
    sourceEntryIds: toJsonString(entryIdList),
    sourceDigestSlugs: toJsonString(digestContext.map((s) => s.slug)),
    sourceDocIds: toJsonString(sourceDocIds),
    claimCount: totalClaims,
    groundedClaimCount: groundedClaims,
    groundingRatio,
    lastGenerated: timestamp,
    lastVerified: null,
    staleAfterDays: input.itemType === "briefing" ? 30 : 90,
    staleTriggerIds: toJsonString(entryIdList),
    status: "current",
    periodFrom: input.periodFrom || null,
    periodTo: input.periodTo || null,
    autoRefresh: false,
    generationModel: MODEL,
    generationPromptHash: promptHash,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  // Insert claims
  for (const claim of parsed.claims) {
    await db.insert(knowledgeClaims).values({
      id: generateId(),
      knowledgeItemId: id,
      claimText: claim.text,
      sourceDocId: claim.sourceEntryId
        ? docs.find((d) => d.entryId === claim.sourceEntryId)?.id || null
        : null,
      sourceEntryId: claim.sourceEntryId || null,
      sourceSection: claim.sourceSection || null,
      groundingType: claim.groundingType,
      confidence: claim.confidence,
      disputed: false,
      disputeNote: null,
      createdAt: timestamp,
    });
  }

  // Return the created item
  const [created] = await db
    .select()
    .from(knowledgeItems)
    .where(eq(knowledgeItems.id, id));

  return serializeKnowledgeItem(created);
}

// --- Generate a briefing ---

interface GenerateBriefingInput {
  periodFrom: string;
  periodTo: string;
  jurisdiction?: string;
  category?: string;
}

export async function generateBriefing(
  input: GenerateBriefingInput
): Promise<KnowledgeItem> {
  // Gather entries updated in the period
  const allEntries = await db.select().from(entries).where(eq(entries.archived, false));
  const periodEntries = allEntries.filter((e) => {
    return e.updatedAt >= input.periodFrom && e.updatedAt <= input.periodTo + "T23:59:59";
  });

  // Gather digest stories from the period (from DB). Regulatory only —
  // Industry Intel / pulse items stay out of the knowledge corpus (B2).
  const allStoryRows = await db
    .select()
    .from(digestStories)
    .where(eq(digestStories.contentType, "regulatory"));
  const allIssueRows = await db.select().from(digestIssues);
  const issueMap = new Map(allIssueRows.map((i) => [i.id, i]));

  const periodStories: { slug: string; title: string; summary: string; jurisdiction: string; impact: string; date: string; source: string }[] = [];
  for (const story of allStoryRows) {
    if (story.date >= input.periodFrom && story.date <= input.periodTo) {
      if (input.jurisdiction && story.jurisdictionCode !== input.jurisdiction) continue;
      if (input.category) {
        const cats: string[] = story.categories ? JSON.parse(story.categories) : [];
        if (!cats.includes(input.category)) continue;
      }
      const issue = story.issueId ? issueMap.get(story.issueId) : null;
      periodStories.push({
        slug: issue ? `${issue.slug}:${story.id}` : story.id,
        title: story.title,
        summary: story.summary,
        jurisdiction: story.jurisdictionCode || "",
        impact: story.impact || "Low",
        date: story.date,
        source: story.source,
      });
    }
  }

  // Gather source docs for period entries
  const entryIds = periodEntries.map((e) => e.id);
  const docs = entryIds.length
    ? await db.select().from(sourceDocuments).where(inArray(sourceDocuments.entryId, entryIds))
    : [];

  const serialized = periodEntries.map(serializeEntry);

  const title = buildBriefingTitle(input);
  const briefingProfileContext = await getProfileContext();
  const draftPrompt = buildBriefingPrompt(input, serialized, periodStories, docs, briefingProfileContext);
  const promptHash = hashPrompt(`${draftPrompt.sources}\n${draftPrompt.instructions}`);

  type BriefingDraft = { sections: BriefingSection[]; claims: AIKnowledgeOutput["claims"] };

  // Stage 1-3: draft → adversarial critique → reconcile.
  const { result: rawBriefing } = await runMultiStageReview<BriefingDraft>({
    draft: draftPrompt,
    buildCritique: (draftJson) =>
      buildBriefingCritiquePrompt(input, draftJson, serialized, periodStories, briefingProfileContext),
    buildReconcile: (draftJson, critiqueJson) =>
      buildBriefingReconcilePrompt(input, draftJson, critiqueJson, serialized, periodStories, briefingProfileContext),
  });

  // Stage 4: verify briefing claims against source documents.
  const verifiedClaims = await verifyKnowledgeClaims(rawBriefing.claims, docs);
  const parsed: BriefingDraft = {
    sections: rawBriefing.sections,
    claims: verifiedClaims,
  };

  const totalClaims = parsed.claims.length;
  const groundedClaims = parsed.claims.filter((c) => c.groundingType !== "ai_knowledge").length;
  const groundingRatio = totalClaims > 0 ? groundedClaims / totalClaims : 0;
  const confidence = computeConfidence(groundingRatio, docs, parsed.claims);
  const groundedIn = computeGrounding(groundingRatio, docs.length);

  const briefingContent: BriefingContent = {
    sections: parsed.sections,
    overallConfidence: confidence,
    groundingRatio,
    entryCount: periodEntries.length,
    digestCount: periodStories.length,
    sourceDocCount: docs.filter((d) => d.fullText).length,
  };

  const timestamp = now();
  const slug = slugify(title);
  const id = generateId();

  await db.insert(knowledgeItems).values({
    id,
    slug,
    title,
    itemType: "briefing",
    jurisdiction: input.jurisdiction || null,
    category: input.category || null,
    content: JSON.stringify(briefingContent),
    contentHtml: null,
    confidence,
    groundedIn,
    sourceEntryIds: toJsonString(entryIds),
    sourceDigestSlugs: toJsonString(periodStories.map((s) => s.slug)),
    sourceDocIds: toJsonString(docs.map((d) => d.id)),
    claimCount: totalClaims,
    groundedClaimCount: groundedClaims,
    groundingRatio,
    lastGenerated: timestamp,
    lastVerified: null,
    staleAfterDays: 30,
    staleTriggerIds: toJsonString(entryIds),
    status: "current",
    periodFrom: input.periodFrom,
    periodTo: input.periodTo,
    autoRefresh: false,
    generationModel: MODEL,
    generationPromptHash: promptHash,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  // Insert claims
  for (const claim of parsed.claims) {
    await db.insert(knowledgeClaims).values({
      id: generateId(),
      knowledgeItemId: id,
      claimText: claim.text,
      sourceDocId: null,
      sourceEntryId: claim.sourceEntryId || null,
      sourceSection: claim.sourceSection || null,
      groundingType: claim.groundingType,
      confidence: claim.confidence,
      disputed: false,
      disputeNote: null,
      createdAt: timestamp,
    });
  }

  const [created] = await db
    .select()
    .from(knowledgeItems)
    .where(eq(knowledgeItems.id, id));

  return serializeKnowledgeItem(created);
}

// --- Prompt builders ---

function buildKnowledgePrompt(
  input: GenerateKnowledgeInput,
  entryRows: ReturnType<typeof serializeEntry>[],
  docs: (typeof sourceDocuments.$inferSelect)[],
  digestStoriesCtx: { slug: string; title: string; summary: string }[],
  profileContext?: string
): CachedPrompt {
  // Partial: topics compile via lib/topics.ts and pinned answers are stored
  // verbatim — neither goes through this generator.
  const typeInstructions: Partial<Record<KnowledgeItemType, string>> = {
    concept: `Write a comprehensive concept analysis page. Cover: definition, how it applies across relevant jurisdictions, key provisions, recent developments, and practical implications for a SaaS/technology company. Structure with clear sections.`,
    comparison: `Write a structured cross-jurisdiction comparison. Use a clear format with jurisdiction-by-jurisdiction analysis, then a synthesis of key differences and commonalities. Include specific provisions and requirements.`,
    entity: `Write a comprehensive entity profile. Cover: role and mandate, enforcement powers, recent actions, regulatory posture and priorities, key publications, and practical implications for regulated entities.`,
    trend: `Write a trend analysis. Cover: what's happening across jurisdictions, what's driving it, where it's heading, key indicators to watch, and implications for a SaaS/technology company.`,
    briefing: `Write an intelligence briefing. This should not be used directly — use generateBriefing instead.`,
  };

  const entriesContext = entryRows
    .map((e) => {
      const parts = [`[${e.id}] ${e.shortName} (${e.fullName})`, `Jurisdiction: ${e.jurisdiction} | Category: ${e.category} | Type: ${e.type} | Status: ${e.status}`];
      if (e.summary) parts.push(`Summary: ${e.summary}`);
      if (e.whyItMatters) parts.push(`Why it matters: ${e.whyItMatters}`);
      if (e.complianceImplications) parts.push(`Compliance: ${e.complianceImplications}`);
      if (e.penalties) parts.push(`Penalties: ${e.penalties}`);
      if (e.openQuestions) parts.push(`Open questions: ${e.openQuestions}`);
      if (e.notes) parts.push(`Notes: ${e.notes}`);
      if (e.regulator) parts.push(`Regulator: ${e.regulator}`);
      return parts.join("\n");
    })
    .join("\n\n---\n\n");

  const sources = buildKnowledgeSourcesBlock(docs);

  const digestContext = digestStoriesCtx
    .map((s) => `[Digest: ${s.slug}] ${s.title}\n${s.summary}`)
    .join("\n\n");

  const instructions = `You are a senior legal intelligence analyst maintaining a knowledge base for a SaaS company tracking APJ regulation (AU, NZ, SG, JP, HK, IN, PH).

${profileContext ? `USER CONTEXT:\n${profileContext}\n\n` : ""}TASK: Generate a knowledge page titled "${input.title}" (type: ${input.itemType}).

${typeInstructions[input.itemType] ?? ""}

${input.customInstructions ? `ADDITIONAL INSTRUCTIONS: ${input.customInstructions}` : ""}

TRACKER ENTRIES:
${entriesContext || "No directly relevant tracker entries."}

${sources ? "Primary source documents are provided in the preceding content block. Treat them as ground truth." : "No primary source documents available."}

${digestContext ? `RECENT DIGEST STORIES:\n${digestContext}` : "No recent digest stories."}

CRITICAL TRUST RULES:
1. Every factual claim MUST be categorized by how it's grounded:
   - "direct_quote": directly quoted from a source document (highest trust)
   - "paraphrase": restated from a source document or entry (high trust)
   - "inference": logically derived from source material (medium trust)
   - "ai_knowledge": from your training data, NOT in any provided source (lowest trust — MUST be flagged)
2. NEVER launder AI knowledge as sourced fact. If a claim comes from your training data rather than the provided documents/entries, it MUST be marked as "ai_knowledge".
3. When sources conflict, present BOTH positions. Do not silently pick one.
4. Include specific section/article references where possible (e.g. "Section 26(1)", "Article 4").

Return ONLY valid JSON:
{
  "content": "<The full knowledge page content. Use plain text with paragraph breaks (\\n\\n). Use bullet points with • character. Do NOT use markdown headers or bold — structure with paragraph text and bullets only. Be thorough and specific.>",
  "claims": [
    {
      "text": "<A specific factual assertion from the content>",
      "sourceEntryId": "<entry ID if grounded in a tracker entry, or omit>",
      "sourceSection": "<specific section/article reference if applicable, or omit>",
      "groundingType": "<direct_quote | paraphrase | inference | ai_knowledge>",
      "confidence": "<high | medium | low>"
    }
  ],
  "suggestedRelatedEntryIds": ["<entry IDs that should be cross-referenced>"]
}

Include 5-15 claims covering the key factual assertions in the content. Every major factual statement should have a corresponding claim.`;

  return { sources, instructions };
}

// Build the cacheable source-documents block, shared across draft / critique /
// reconcile. Order is deterministic so the cache key is stable.
function buildKnowledgeSourcesBlock(
  docs: (typeof sourceDocuments.$inferSelect)[]
): string {
  const withText = docs.filter((d) => d.fullText);
  if (withText.length === 0) return "";
  return `PRIMARY SOURCE DOCUMENTS:\n${withText
    .map((d) => {
      const authority = d.sourceAuthority || "unknown";
      return `[Source Doc: ${d.name}] (authority: ${authority}, entry: ${d.entryId})\n${d.fullText!.slice(0, MAX_DOC_CHARS)}`;
    })
    .join("\n\n===\n\n")}`;
}

function buildBriefingPrompt(
  input: GenerateBriefingInput,
  entryRows: ReturnType<typeof serializeEntry>[],
  stories: { slug: string; title: string; summary: string; jurisdiction: string; impact: string; date: string; source: string }[],
  docs: (typeof sourceDocuments.$inferSelect)[],
  profileContext?: string
): CachedPrompt {
  const entriesContext = entryRows
    .map((e) => `[${e.id}] ${e.shortName} (${e.jurisdiction}, ${e.status}) — ${e.summary?.slice(0, 200) || "No summary"}`)
    .join("\n");

  const storiesContext = stories
    .map((s) => `[${s.slug}] ${s.title} (${s.jurisdiction}, ${s.impact} impact, ${s.date}) — ${s.summary.slice(0, 200)}`)
    .join("\n");

  const sources = buildKnowledgeSourcesBlock(docs);
  const docsAvailable = docs.filter((d) => d.fullText).length;

  const instructions = `You are Argus, a legal intelligence platform. Generate a weekly intelligence briefing.

${profileContext ? `USER CONTEXT:\n${profileContext}\n\n` : ""}PERIOD: ${input.periodFrom} to ${input.periodTo}
${input.jurisdiction ? `JURISDICTION FILTER: ${input.jurisdiction}` : "ALL JURISDICTIONS"}
${input.category ? `CATEGORY FILTER: ${input.category}` : "ALL CATEGORIES"}

TRACKER ENTRIES UPDATED IN THIS PERIOD:
${entriesContext || "No entries updated."}

DIGEST STORIES FROM THIS PERIOD:
${storiesContext || "No digest stories."}

SOURCE DOCUMENTS AVAILABLE: ${docsAvailable} documents with full text

INSTRUCTIONS:
Generate a structured briefing with these sections:
1. "Key Developments" — the most significant regulatory changes or actions
2. "Upcoming Deadlines" — compliance deadlines approaching in the next 30-90 days
3. "Emerging Themes" — patterns or trends across jurisdictions
4. "Watchlist" — items that need monitoring but aren't urgent yet

For each item, cite the specific tracker entry or digest story it comes from. Ground every claim.

TRUST RULES: Same as knowledge items — categorize each claim by grounding type. Never present AI knowledge as sourced fact.

Return ONLY valid JSON:
{
  "sections": [
    {
      "heading": "<section title>",
      "items": [
        {
          "claim": "<the factual statement>",
          "entryId": "<tracker entry ID if applicable>",
          "entryName": "<entry short name if applicable>",
          "digestSlug": "<digest story slug if applicable>",
          "confidence": "<high | medium | low>",
          "sourceAuthority": "<official_legislation | official_regulator | law_firm_analysis | news | mixed>",
          "sourceSection": "<specific section reference if applicable>"
        }
      ]
    }
  ],
  "claims": [
    {
      "text": "<factual assertion>",
      "sourceEntryId": "<entry ID or omit>",
      "sourceSection": "<section ref or omit>",
      "groundingType": "<direct_quote | paraphrase | inference | ai_knowledge>",
      "confidence": "<high | medium | low>"
    }
  ]
}`;

  return { sources, instructions };
}

// --- Critique and reconcile prompt builders ---

function buildKnowledgeCritiquePrompt(
  input: GenerateKnowledgeInput,
  draftJson: string,
  entryRows: ReturnType<typeof serializeEntry>[],
  docs: (typeof sourceDocuments.$inferSelect)[],
  profileContext?: string
): CachedPrompt {
  const sources = buildKnowledgeSourcesBlock(docs);

  const instructions = `You are a senior regulatory enforcement lawyer reviewing a colleague's draft knowledge page. Your job is to play devil's advocate and find every weakness in the draft before it goes to the client.

${profileContext ? `USER CONTEXT:\n${profileContext}\n\n` : ""}KNOWLEDGE PAGE UNDER REVIEW:
- Title: "${input.title}" (type: ${input.itemType})
${input.jurisdiction ? `- Jurisdiction filter: ${input.jurisdiction}` : ""}
${input.category ? `- Category filter: ${input.category}` : ""}

DRAFT TO CRITIQUE:
${draftJson}

TRACKER ENTRIES IN SCOPE:
${entryRows.map((e) => `- [${e.id}] ${e.shortName} (${e.jurisdiction}, ${e.status})`).join("\n") || "(none)"}

${sources ? "Primary source documents are provided in the preceding content block." : "(no source documents)"}

YOUR JOB:
Surface only PROBLEMS in the draft. Be ruthless and specific:

1. **Missed issues** — important provisions, jurisdictions, instruments, or distinctions the draft skipped that the user would expect to see for a "${input.itemType}" titled "${input.title}".
2. **Weak claims** — vague generalities, conflations of distinct legal concepts, claims that don't follow from the cited entry/doc, or claims labeled with the wrong groundingType.
3. **Counter-readings** — places where a regulator or counterparty could plausibly read a provision differently than the draft suggests.
4. **Jurisdictional concerns** — territorial scope errors, omitted jurisdictions where one was expected, inconsistencies in how the draft treats different jurisdictions, or staleness vs the latest cited material.

DO NOT:
- Repeat what the draft already says.
- Praise the draft. Only flag problems.
- Make up new legal facts. Use only the entries and docs above.
- Suggest stylistic changes.

Return ONLY valid JSON in this exact shape (use empty arrays for categories with no findings):
{
  "overallAssessment": "<2-3 sentence summary of the draft's biggest weaknesses>",
  "missedIssues": [{ "section": "<which section of the draft>", "severity": "high|medium|low", "problem": "<what's missing>", "suggestedFix": "<concrete addition with citation>" }],
  "weakClaims": [{ "section": "<section>", "severity": "...", "problem": "...", "suggestedFix": "..." }],
  "counterReadings": [{ "section": "...", "severity": "...", "problem": "...", "suggestedFix": "..." }],
  "jurisdictionalConcerns": [{ "section": "...", "severity": "...", "problem": "...", "suggestedFix": "..." }]
}`;

  return { sources, instructions };
}

function buildKnowledgeReconcilePrompt(
  input: GenerateKnowledgeInput,
  draftJson: string,
  critiqueJson: string,
  entryRows: ReturnType<typeof serializeEntry>[],
  docs: (typeof sourceDocuments.$inferSelect)[],
  profileContext?: string
): CachedPrompt {
  const sources = buildKnowledgeSourcesBlock(docs);

  const instructions = `You are the senior legal intelligence analyst who wrote the draft below. A reviewing enforcement lawyer has critiqued it. Produce a revised version that addresses every legitimate critique while preserving everything that was already correct.

${profileContext ? `USER CONTEXT:\n${profileContext}\n\n` : ""}KNOWLEDGE PAGE: "${input.title}" (type: ${input.itemType})
${input.jurisdiction ? `Jurisdiction filter: ${input.jurisdiction}` : ""}
${input.category ? `Category filter: ${input.category}` : ""}

YOUR ORIGINAL DRAFT:
${draftJson}

REVIEWER CRITIQUE:
${critiqueJson}

TRACKER ENTRIES:
${entryRows.map((e) => `- [${e.id}] ${e.shortName} (${e.jurisdiction})`).join("\n") || "(none)"}

${sources ? "Primary source documents are provided in the preceding content block. Re-read the cited sections before revising." : "(no source documents)"}

HOW TO REVISE:
- Address every "high" severity issue. Address "medium" if you agree with it after re-reading the source. Use judgement on "low".
- If you disagree with a critique item (the reviewer is wrong about what the source says), keep the original claim.
- For missed issues, add the corresponding content + claims with proper grounding.
- For weak claims, tighten the wording or split into narrower claims, and update groundingType if needed.
- For counter-readings, acknowledge the alternative reading (groundingType: "inference") rather than picking one side without evidence.
- DO NOT delete claims unless the critique shows they are wrong.
- DO NOT invent section references. If you don't have a clean cite, mark groundingType as "inference" or "ai_knowledge".

Return the FULL revised JSON in EXACTLY the same shape as the original draft. Do not return only the changes.

Return ONLY valid JSON.`;

  return { sources, instructions };
}

function buildBriefingCritiquePrompt(
  input: GenerateBriefingInput,
  draftJson: string,
  entryRows: ReturnType<typeof serializeEntry>[],
  stories: { slug: string; title: string; summary: string; jurisdiction: string; impact: string; date: string; source: string }[],
  profileContext?: string
): CachedPrompt {
  const instructions = `You are a senior regulatory enforcement lawyer reviewing a draft weekly briefing. Find every weakness before it goes to the client.

${profileContext ? `USER CONTEXT:\n${profileContext}\n\n` : ""}BRIEFING UNDER REVIEW:
- Period: ${input.periodFrom} to ${input.periodTo}
${input.jurisdiction ? `- Jurisdiction filter: ${input.jurisdiction}` : "- All jurisdictions"}
${input.category ? `- Category filter: ${input.category}` : "- All categories"}

DRAFT TO CRITIQUE:
${draftJson}

TRACKER ENTRIES IN PERIOD:
${entryRows.map((e) => `- [${e.id}] ${e.shortName} (${e.jurisdiction}, ${e.status})`).join("\n") || "(none)"}

DIGEST STORIES IN PERIOD:
${stories.map((s) => `- [${s.slug}] ${s.title} (${s.jurisdiction}, ${s.impact}, ${s.date})`).join("\n") || "(none)"}

Surface only PROBLEMS:
1. **Missed issues** — significant developments in the period that the briefing didn't cover, or upcoming deadlines that should be flagged but weren't.
2. **Weak claims** — vague items, items mis-categorized into the wrong section ("Key Developments" vs "Watchlist"), wrong impact ratings, mis-attributed sources.
3. **Counter-readings** — items where the briefing's framing oversimplifies an unsettled issue.
4. **Jurisdictional concerns** — uneven coverage, items wrong-jurisdiction-labeled, or important cross-jurisdiction analogues missed.

Return ONLY valid JSON:
{
  "overallAssessment": "<2-3 sentences>",
  "missedIssues": [{ "section": "<section heading>", "severity": "...", "problem": "...", "suggestedFix": "..." }],
  "weakClaims": [...],
  "counterReadings": [...],
  "jurisdictionalConcerns": [...]
}`;

  // Briefings don't include source-doc full text; sources stays empty.
  return { sources: "", instructions };
}

function buildBriefingReconcilePrompt(
  input: GenerateBriefingInput,
  draftJson: string,
  critiqueJson: string,
  entryRows: ReturnType<typeof serializeEntry>[],
  stories: { slug: string; title: string; summary: string; jurisdiction: string; impact: string; date: string; source: string }[],
  profileContext?: string
): CachedPrompt {
  const instructions = `You are the analyst who wrote the briefing below. A reviewing enforcement lawyer critiqued it. Produce a revised version addressing every legitimate critique.

${profileContext ? `USER CONTEXT:\n${profileContext}\n\n` : ""}PERIOD: ${input.periodFrom} to ${input.periodTo}
${input.jurisdiction ? `Jurisdiction filter: ${input.jurisdiction}` : ""}

YOUR ORIGINAL DRAFT:
${draftJson}

REVIEWER CRITIQUE:
${critiqueJson}

TRACKER ENTRIES:
${entryRows.map((e) => `- [${e.id}] ${e.shortName}`).join("\n") || "(none)"}

DIGEST STORIES:
${stories.map((s) => `- [${s.slug}] ${s.title}`).join("\n") || "(none)"}

Address every high-severity issue and every medium-severity issue you agree with. For missed items, add new section items with proper grounding (entryId, digestSlug, groundingType). For weak items, tighten or recategorise. For counter-readings, soften framing (groundingType "inference"). Do not invent.

Return the FULL revised JSON in EXACTLY the same shape as the original draft. Do not return only the changes.

Return ONLY valid JSON.`;

  return { sources: "", instructions };
}

function buildBriefingTitle(input: GenerateBriefingInput): string {
  const to = new Date(input.periodTo);
  const weekNum = getWeekNumber(to);
  const year = to.getFullYear();
  const scope = input.jurisdiction || "APAC";
  const topic = input.category ? ` — ${input.category}` : "";
  return `${scope} Regulatory Briefing W${weekNum} ${year}${topic}`;
}

function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

// --- Helper functions ---

function filterRelevantEntries(
  allEntries: (typeof entries.$inferSelect)[],
  input: GenerateKnowledgeInput
) {
  return allEntries.filter((e) => {
    if (input.jurisdiction && e.jurisdiction !== input.jurisdiction) return false;
    if (input.category && e.category !== input.category) return false;
    // For concepts/comparisons, include all non-archived entries in scope
    return true;
  });
}

async function gatherDigestContext(input: GenerateKnowledgeInput) {
  // Regulatory only — see B2 note above.
  const allStories = await db
    .select()
    .from(digestStories)
    .where(eq(digestStories.contentType, "regulatory"));
  const allIssueRows = await db.select().from(digestIssues);
  const issueMap = new Map(allIssueRows.map((i) => [i.id, i]));

  const stories: { slug: string; title: string; summary: string }[] = [];
  for (const story of allStories) {
    if (input.jurisdiction && story.jurisdictionCode !== input.jurisdiction) continue;
    if (input.category) {
      const cats: string[] = story.categories ? JSON.parse(story.categories) : [];
      if (!cats.includes(input.category)) continue;
    }
    const issue = story.issueId ? issueMap.get(story.issueId) : null;
    stories.push({
      slug: issue ? `${issue.slug}:${story.id}` : story.id,
      title: story.title,
      summary: story.summary,
    });
  }
  return stories.slice(0, 20);
}

function computeConfidence(
  groundingRatio: number,
  docs: (typeof sourceDocuments.$inferSelect)[],
  claims: AIKnowledgeOutput["claims"]
): KnowledgeConfidence {
  const hasOfficialSources = docs.some(
    (d) => d.sourceAuthority === "official_legislation" || d.sourceAuthority === "official_regulator"
  );
  const highConfidenceClaims = claims.filter((c) => c.confidence === "high").length;
  const highRatio = claims.length > 0 ? highConfidenceClaims / claims.length : 0;

  if (groundingRatio >= 0.8 && hasOfficialSources && highRatio >= 0.6) return "high";
  if (groundingRatio >= 0.5 || (hasOfficialSources && groundingRatio >= 0.3)) return "medium";
  if (groundingRatio > 0) return "low";
  return "unverified";
}

function computeGrounding(
  groundingRatio: number,
  docCount: number
): KnowledgeGrounding {
  if (docCount > 0 && groundingRatio >= 0.7) return "sources";
  if (groundingRatio >= 0.5) return "entries";
  if (groundingRatio > 0) return "mixed";
  return "ai_knowledge";
}

// --- Serialization ---

export function serializeKnowledgeItem(
  row: typeof knowledgeItems.$inferSelect
): KnowledgeItem {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    itemType: row.itemType as KnowledgeItemType,
    jurisdiction: row.jurisdiction,
    category: row.category,
    content: row.content,
    contentHtml: row.contentHtml,
    confidence: row.confidence as KnowledgeConfidence,
    groundedIn: row.groundedIn as KnowledgeGrounding,
    sourceEntryIds: row.sourceEntryIds ? JSON.parse(row.sourceEntryIds) : null,
    sourceDigestSlugs: row.sourceDigestSlugs ? JSON.parse(row.sourceDigestSlugs) : null,
    sourceDocIds: row.sourceDocIds ? JSON.parse(row.sourceDocIds) : null,
    claimCount: row.claimCount || 0,
    groundedClaimCount: row.groundedClaimCount || 0,
    groundingRatio: row.groundingRatio || 0,
    lastGenerated: row.lastGenerated,
    lastVerified: row.lastVerified,
    staleAfterDays: row.staleAfterDays || 90,
    staleTriggerIds: row.staleTriggerIds ? JSON.parse(row.staleTriggerIds) : null,
    status: row.status as KnowledgeItem["status"],
    periodFrom: row.periodFrom,
    periodTo: row.periodTo,
    topicTerms: row.topicTerms ? JSON.parse(row.topicTerms) : null,
    autoRefresh: row.autoRefresh || false,
    generationModel: row.generationModel,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
