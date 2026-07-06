import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/db";
import { digestIssues, digestStories, entries } from "@/db/schema";
import { eq } from "drizzle-orm";
import { generateId, now } from "@/lib/utils";
import {
  JURISDICTION_CONFIGS,
  MODELS,
  COST_BUDGET_USD,
  TIER_STORY_TARGETS,
  SEARCH_PROFILES,
  JURISDICTION_EXTRA_PROFILES,
  SEARCH_TOPICS,
  KEY_REGULATORS,
  type JurisdictionConfig,
} from "./config";
import { buildTrackerContext } from "./tracker-context";
import {
  exaSearch,
  anthropicWebSearchFallback,
  newAccountant,
  type SearchHit,
  type SearchAccountant,
} from "./search";
import {
  jurisdictionExtractionPrompt,
  synthesisPrompt,
  trackerContextString,
  companyContextBlock,
} from "./prompts";
import { CostGuard } from "./cost-guard";
import { readCached, writeCached } from "./cache";
import { extractReferencesForStory } from "./extract-references";
import { pullFeeds, formatPreSeededStories } from "./rss";
import {
  findMilestoneEntries,
  findMissedMilestones,
  formatMilestoneWatch,
  milestoneSearchQuery,
  type MilestoneEntry,
} from "./miss-detection";
import { getCompanyContext, getCompanyMeta } from "@/lib/company-context";

const anthropic = new Anthropic();

// ─── Public API ──────────────────────────────────────────────────────────────

export interface RunOptions {
  cached?: boolean;
  dryRun?: boolean;
  jurisdictions?: string[]; // override default Tier-1 set
  skipSynthesis?: boolean;
  referenceDate?: string; // YYYY-MM-DD; resolves the Mon–Sun week containing it. Defaults to now.
}

export interface RunResult {
  issueId: string | null;
  weekStart: string;
  storyCount: number;
  coverageGaps: string[];
  /** Tracked milestones inside the week that produced no story — known misses. */
  missedMilestones: string[];
  costUsd: number;
  durationMs: number;
  dryRun: boolean;
}

interface ExtractedStory {
  title: string;
  url: string;
  source_name: string;
  source_type: "regulator" | "court" | "publication" | "law_firm";
  date: string;
  summary: string;
  takeaways: string[];
  urgency: "immediate_action" | "monitor_closely" | "awareness_only";
  urgency_reason?: string;
  categories: string[];
  entry_type_hint: string;
  lifecycle_stage: "Proposed" | "Consultation" | "Enacted" | "Effective" | "Enforced";
  impact: "Low" | "Medium" | "High";
  compliance_deadline?: string | null;
  regulator?: string | null;
  background_context?: string;
  related_tracker_hint?: string | null;
  topic_searched?: string;
  jurisdiction_code: string;
  // Cleaned article body from the originating search hit, captured for
  // conversational "Ask about this story" grounding. Not model output —
  // attached post-extraction by matching the story URL to its hit.
  articleText?: string;
}

// Slimmed June 2026 (refinement plan B1): the issue is executive brief +
// stories only. The radar/cross-border/scorecard/region sections were cut —
// radar content lives on the live Horizon page, thematic synthesis in
// Signals. The schema columns remain but are no longer populated.
interface SynthesisOutput {
  duplicate_urls_to_remove?: string[];
  title?: string;
  slug?: string;
  executive_brief: string;
  synopsis: string[];
  ranked_urls: string[];
  exceptional_week?: boolean;
}

// ─── Orchestrator ────────────────────────────────────────────────────────────

export async function runDigestIngest(opts: RunOptions = {}): Promise<RunResult> {
  const startedAt = Date.now();
  const dryRun = opts.dryRun === true;

  const reference = opts.referenceDate ? new Date(opts.referenceDate + "T00:00:00Z") : new Date();
  if (Number.isNaN(reference.getTime())) {
    throw new Error(`Invalid referenceDate: ${opts.referenceDate}`);
  }
  const { weekStart, weekEnd } = resolveWeekRange(reference);
  console.log(`[digest] Week ${weekStart} → ${weekEnd}${dryRun ? " (DRY RUN)" : ""}`);

  const targetCodes =
    opts.jurisdictions && opts.jurisdictions.length > 0
      ? opts.jurisdictions
      : JURISDICTION_CONFIGS.filter((j) => j.tier === "T1").map((j) => j.code);

  const jurisdictionConfigs = targetCodes
    .map((code) => JURISDICTION_CONFIGS.find((j) => j.code === code))
    .filter((j): j is JurisdictionConfig => Boolean(j));

  if (jurisdictionConfigs.length === 0) {
    throw new Error(`No matching jurisdictions for ${targetCodes.join(", ")}`);
  }

  const companyMeta = getCompanyMeta();
  const companyBlock = companyContextBlock({
    name: companyMeta.name,
    descriptor: companyMeta.descriptor,
    context: getCompanyContext() ?? "",
  });

  const trackerContext = await buildTrackerContext();
  // Company context + tracker context share one cached block: stable across
  // all extraction calls in a run, so it's written to the prompt cache once.
  const trackerBlock = `${companyBlock}\n\n${trackerContextString(trackerContext, companyMeta.name)}`;

  // Only milestones in jurisdictions this run actually covers — a Tier-2
  // milestone can't be a miss of a Tier-1-only run.
  const milestones = findMilestoneEntries(weekStart, weekEnd).filter((m) =>
    targetCodes.includes(m.jurisdictionCode)
  );
  if (milestones.length > 0) {
    console.log(
      `[digest] ${milestones.length} tracked milestone(s) this week: ${milestones.map((m) => `${m.shortName} (${m.date})`).join("; ")}`
    );
  }

  const guard = new CostGuard(COST_BUDGET_USD);
  const accountant = newAccountant();

  // Per-jurisdiction extraction (parallel).
  const settled = await Promise.allSettled(
    jurisdictionConfigs.map((j) =>
      extractForJurisdiction(j, {
        weekStart,
        weekEnd,
        trackerBlock,
        companyName: companyMeta.name,
        milestones,
        guard,
        accountant,
        cached: opts.cached === true,
      })
    )
  );

  const allStories: ExtractedStory[] = [];
  const coverageGaps: string[] = [];
  for (let i = 0; i < settled.length; i++) {
    const j = jurisdictionConfigs[i];
    const r = settled[i];
    if (r.status === "fulfilled") {
      const target = TIER_STORY_TARGETS[j.tier];
      if (r.value.length < target) {
        console.warn(`[digest] ${j.code} sparse: ${r.value.length} < target ${target}`);
      }
      allStories.push(...r.value);
    } else {
      console.error(`[digest] ${j.code} failed:`, r.reason);
      coverageGaps.push(j.code);
    }
  }

  console.log(
    `[digest] Extraction complete. ${allStories.length} raw stories, ${coverageGaps.length} jurisdiction gaps.`
  );
  console.log(
    `[digest] Search spend so far: ${accountant.searchCount} searches ≈ $${accountant.estimatedUsd.toFixed(2)}`
  );
  guard.addExternal(accountant.estimatedUsd);

  if (allStories.length === 0) {
    throw new Error("No stories extracted across all jurisdictions — aborting before synthesis.");
  }

  // Synthesis.
  const skipSynthesis = dryRun || opts.skipSynthesis === true;
  let synthesis: SynthesisOutput | null = null;
  let finalStories = allStories;

  if (!skipSynthesis) {
    synthesis = await synthesizeIssue(allStories, guard, companyMeta.name, companyBlock);
    finalStories = applySynthesis(allStories, synthesis);
  }

  // Known-miss check: tracked milestones this week with no covering story.
  // Checked against ALL extracted stories (pre-ranking) — a story that was
  // found but cut by the top-10 cap is a ranking decision, not a recall miss.
  const missed = findMissedMilestones(milestones, allStories);
  const missedMilestones = missed.map((m) => `${m.shortName} — ${m.label} (${m.date})`);
  for (const m of missedMilestones) {
    console.warn(`[digest] MISSED MILESTONE: ${m}`);
  }

  const totalUsd = guard.totalUsd();
  const durationMs = Date.now() - startedAt;

  if (dryRun) {
    console.log(
      `[digest] DRY RUN complete. Would write ${finalStories.length} stories. Spend $${totalUsd.toFixed(2)}.`
    );
    return {
      issueId: null,
      weekStart,
      storyCount: finalStories.length,
      coverageGaps,
      missedMilestones,
      costUsd: totalUsd,
      durationMs,
      dryRun: true,
    };
  }

  if (!synthesis) {
    throw new Error("Synthesis missing — refusing to write digest issue without it.");
  }

  // Write to DB (upsert by week_start).
  const { issueId, storyIds } = writeDigest({
    weekStart,
    weekEnd,
    stories: finalStories,
    synthesis,
    coverageGaps,
    costUsd: totalUsd,
    durationMs,
    trackerEntries: trackerContext.trackerShortNames,
  });

  console.log(
    `[digest] Wrote issue ${issueId} with ${finalStories.length} stories. Spend $${totalUsd.toFixed(2)}, duration ${(durationMs / 1000).toFixed(1)}s.`
  );

  // Extract trackable references for each newly written story.
  console.log(`[digest] Extracting references for ${storyIds.length} stories…`);
  const refStart = Date.now();
  let refTotal = 0;
  for (const storyId of storyIds) {
    try {
      const refs = await extractReferencesForStory(storyId);
      refTotal += refs.length;
    } catch (err) {
      console.warn(`[digest] reference extraction failed for ${storyId}:`, err);
    }
  }
  console.log(
    `[digest] Reference extraction complete. ${refTotal} references across ${storyIds.length} stories in ${((Date.now() - refStart) / 1000).toFixed(1)}s.`
  );

  return {
    issueId,
    weekStart,
    storyCount: finalStories.length,
    coverageGaps,
    missedMilestones,
    costUsd: totalUsd,
    durationMs,
    dryRun: false,
  };
}

// ─── Per-jurisdiction extraction ─────────────────────────────────────────────

interface ExtractionContext {
  weekStart: string;
  weekEnd: string;
  trackerBlock: string;
  companyName: string;
  milestones: MilestoneEntry[];
  guard: CostGuard;
  accountant: SearchAccountant;
  cached: boolean;
}

// Below this many unique hits, a jurisdiction's Exa pool is considered thin
// and the Anthropic web-search fallback pass runs to backfill.
const FALLBACK_HIT_THRESHOLD = 6;
const MILESTONE_SEARCHES_PER_JURISDICTION = 3;

async function extractForJurisdiction(
  j: JurisdictionConfig,
  ctx: ExtractionContext
): Promise<ExtractedStory[]> {
  const cacheKey = `search-${j.code}`;
  let hits: SearchHit[];

  if (ctx.cached) {
    const replay = readCached<SearchHit[]>(ctx.weekStart, cacheKey);
    if (replay) {
      console.log(`[digest][${j.code}] using ${replay.length} cached hits`);
      hits = replay;
    } else {
      hits = await searchAllTopics(j, ctx);
      writeCached(ctx.weekStart, cacheKey, hits);
    }
  } else {
    hits = await searchAllTopics(j, ctx);
    writeCached(ctx.weekStart, cacheKey, hits); // always write so re-runs can use --cached
  }

  console.log(`[digest][${j.code}] ${hits.length} hits to extract from`);

  // Dedup by URL before sending to Haiku.
  const byUrl = new Map<string, SearchHit>();
  for (const h of hits) if (!byUrl.has(h.url)) byUrl.set(h.url, h);
  const uniqueHits = Array.from(byUrl.values());

  // B1: regulator RSS items inside the week window, injected as pre-seeded
  // stories. Zero cost; catches regulator pages Exa mis-dates or misses.
  let preSeeded = "";
  try {
    const rssItems = await pullFeeds(j.code, ctx.weekStart, ctx.weekEnd);
    if (rssItems.length > 0) {
      console.log(`[digest][${j.code}][rss] ${rssItems.length} pre-seeded item(s) in week window`);
      preSeeded = formatPreSeededStories(rssItems);
    }
  } catch (err) {
    console.warn(`[digest][${j.code}][rss] pre-seed failed:`, err);
  }

  const stories = await extractStories(j, uniqueHits, ctx, preSeeded);
  console.log(`[digest][${j.code}] extracted ${stories.length} stories`);
  return stories;
}

async function searchAllTopics(j: JurisdictionConfig, ctx: ExtractionContext): Promise<SearchHit[]> {
  const profiles = [...SEARCH_PROFILES, ...(JURISDICTION_EXTRA_PROFILES[j.code] ?? [])];
  const allHits: SearchHit[] = [];

  // Sequential, not parallel — so we don't blow Exa rate limits.
  for (const profile of profiles) {
    const query = profile.buildQuery(j.name, j.code);
    const includeDomains = profile.includeDomainsOf(j);
    try {
      const hits = await exaSearch(
        {
          query,
          includeDomains,
          startPublishedDate: ctx.weekStart,
          endPublishedDate: ctx.weekEnd,
          numResults: profile.numResults,
        },
        ctx.accountant
      );
      console.log(
        `[digest][${j.code}][${profile.kind}] ${hits.length} hits (q="${query}", domains=${includeDomains ? includeDomains.length : "any"})`
      );
      for (const h of hits) h.profile = profile.kind;
      allHits.push(...hits);
    } catch (err) {
      console.warn(`[digest][${j.code}][${profile.kind}] search failed:`, err);
    }
  }

  // Targeted searches for tracked milestones this week (miss prevention):
  // the extractor is guaranteed material on events we know are happening.
  const jurisdictionMilestones = ctx.milestones
    .filter((m) => m.jurisdictionCode === j.code)
    .slice(0, MILESTONE_SEARCHES_PER_JURISDICTION);
  for (const m of jurisdictionMilestones) {
    try {
      const hits = await exaSearch(
        {
          query: milestoneSearchQuery(m),
          startPublishedDate: ctx.weekStart,
          endPublishedDate: ctx.weekEnd,
          numResults: 4,
        },
        ctx.accountant
      );
      console.log(`[digest][${j.code}][milestone] ${hits.length} hits for "${m.shortName}"`);
      for (const h of hits) h.profile = "milestone_watch";
      allHits.push(...hits);
    } catch (err) {
      console.warn(`[digest][${j.code}][milestone] search failed for "${m.shortName}":`, err);
    }
  }

  // B2: Anthropic web-search fallback when the pool is thin (Exa outage,
  // index gap, sparse week). One call, merged into the same pool — and part
  // of the cached hit set so --cached replays include it.
  const uniqueUrls = new Set(allHits.map((h) => h.url));
  if (uniqueUrls.size < FALLBACK_HIT_THRESHOLD) {
    console.log(
      `[digest][${j.code}] thin pool (${uniqueUrls.size} unique hits) — running web-search fallback`
    );
    try {
      const fallbackHits = await anthropicWebSearchFallback(
        {
          jurisdictionName: j.name,
          jurisdictionCode: j.code,
          startDate: ctx.weekStart,
          endDate: ctx.weekEnd,
          topics: SEARCH_TOPICS,
          keyRegulators: KEY_REGULATORS[j.code] ?? [],
        },
        ctx.guard
      );
      console.log(`[digest][${j.code}][web_search_fallback] ${fallbackHits.length} hits`);
      allHits.push(...fallbackHits.filter((h) => !uniqueUrls.has(h.url)));
    } catch (err) {
      console.warn(`[digest][${j.code}][web_search_fallback] failed:`, err);
    }
  }

  return allHits;
}

async function extractStories(
  j: JurisdictionConfig,
  hits: SearchHit[],
  ctx: ExtractionContext,
  preSeededStories = ""
): Promise<ExtractedStory[]> {
  if (hits.length === 0 && !preSeededStories) return [];

  const searchHitsBlock = hits
    .map((h, i) => {
      const text = h.text.slice(0, 4000);
      return `--- HIT ${i + 1} ---
URL: ${h.url}
Title: ${h.title}
Published: ${h.publishedDate ?? "n/a"}
Text: ${text}`;
    })
    .join("\n\n");

  const jurisdictionMilestones = ctx.milestones.filter((m) => m.jurisdictionCode === j.code);

  const prompt = jurisdictionExtractionPrompt({
    jurisdictionName: j.name,
    jurisdictionCode: j.code,
    tier: j.tier,
    startDate: ctx.weekStart,
    endDate: ctx.weekEnd,
    regulatorDomains: j.regulatorDomains,
    courtDomains: j.courtDomains,
    preSeededStories,
    searchHits: searchHitsBlock,
    companyName: ctx.companyName,
    milestoneWatch: formatMilestoneWatch(jurisdictionMilestones),
  });

  const response = await anthropic.messages.create({
    model: MODELS.extraction,
    max_tokens: 8000,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: ctx.trackerBlock, cache_control: { type: "ephemeral" } },
          { type: "text", text: prompt },
        ],
      },
    ],
  });

  if (response.stop_reason === "max_tokens") {
    console.warn(`[digest][${j.code}] extraction hit max_tokens — output may be truncated`);
  }

  ctx.guard.recordAnthropic(MODELS.extraction, {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cachedInputTokens: (response.usage as { cache_read_input_tokens?: number }).cache_read_input_tokens ?? 0,
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const parsed = parseJsonArray<ExtractedStory>(text);

  // Attach the originating hit's cleaned body so we can persist it later. The
  // model returns the hit URL verbatim, so a URL match recovers the full text
  // (we keep more than the 4k the prompt saw — up to what Exa fetched).
  const textByUrl = new Map(hits.filter((h) => h.text).map((h) => [h.url, h.text]));

  return parsed.map((s) => ({
    ...s,
    jurisdiction_code: s.jurisdiction_code ?? j.code,
    articleText: s.url ? textByUrl.get(s.url) : undefined,
  }));
}

// ─── Synthesis ───────────────────────────────────────────────────────────────

async function synthesizeIssue(
  stories: ExtractedStory[],
  guard: CostGuard,
  companyName: string,
  companyBlock: string
): Promise<SynthesisOutput> {
  const prompt = synthesisPrompt({
    storiesJson: JSON.stringify(stories, null, 2),
    companyName,
    companyBlock,
  });

  const response = await anthropic.messages.create({
    model: MODELS.synthesis,
    max_tokens: 6000,
    messages: [{ role: "user", content: prompt }],
  });

  guard.recordAnthropic(MODELS.synthesis, {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  return parseJsonObject<SynthesisOutput>(text);
}

function applySynthesis(stories: ExtractedStory[], synth: SynthesisOutput): ExtractedStory[] {
  const drop = new Set(synth.duplicate_urls_to_remove ?? []);
  const order = new Map<string, number>();
  (synth.ranked_urls ?? []).forEach((u, i) => order.set(u, i));

  const ranked = stories
    .filter((s) => !drop.has(s.url))
    .map((s) => ({ s, rank: order.get(s.url) ?? 9999 }))
    .sort((a, b) => a.rank - b.rank);

  const cap = synth.exceptional_week ? 15 : 10;
  return ranked.slice(0, cap).map((r) => r.s);
}

// ─── DB write ────────────────────────────────────────────────────────────────

interface WriteParams {
  weekStart: string;
  weekEnd: string;
  stories: ExtractedStory[];
  synthesis: SynthesisOutput;
  coverageGaps: string[];
  costUsd: number;
  durationMs: number;
  trackerEntries: { id: string; shortName: string }[];
}

function writeDigest(p: WriteParams): { issueId: string; storyIds: string[] } {
  const ts = now();
  const issueId = generateId();
  const fallbackSlug = `digest-${p.weekStart}`;
  const rawSlug = p.synthesis.slug?.trim();
  const slugBase = rawSlug && rawSlug.length > 0 ? slugify(rawSlug) : null;
  const slug = slugBase ? `${p.weekStart}-${slugBase}` : fallbackSlug;
  const title =
    p.synthesis.title?.trim() && p.synthesis.title.trim().length > 0
      ? p.synthesis.title.trim()
      : `Weekly Legal Digest — week of ${p.weekStart}`;
  const weekOfLabel = formatWeekOf(p.weekStart, p.weekEnd);

  // Upsert by week_start: if existing draft/published row, replace.
  const existing = db
    .select({ id: digestIssues.id })
    .from(digestIssues)
    .where(eq(digestIssues.weekStart, p.weekStart))
    .limit(1)
    .all()[0];

  const finalIssueId = existing?.id ?? issueId;

  if (existing) {
    db.delete(digestStories).where(eq(digestStories.issueId, existing.id)).run();
    db.update(digestIssues)
      .set({
        slug,
        title,
        date: p.weekStart,
        weekOf: weekOfLabel,
        weekStart: p.weekStart,
        synopsis: JSON.stringify(p.synthesis.synopsis ?? []),
        storyCount: p.stories.length,
        jurisdictionCount: new Set(p.stories.map((s) => s.jurisdiction_code)).size,
        readTime: Math.max(5, Math.round(p.stories.length * 1.5)),
        status: "published",
        executiveBrief: p.synthesis.executive_brief,
        // Cut sections: null them on regeneration so stale content from
        // pre-slim runs doesn't linger on the row.
        regulatoryRadar: null,
        crossBorderWatch: null,
        complianceScorecard: null,
        regionInsights: null,
        coverageGaps: JSON.stringify(p.coverageGaps),
        ingestCostUsd: p.costUsd,
        ingestDurationMs: p.durationMs,
        updatedAt: ts,
      })
      .where(eq(digestIssues.id, existing.id))
      .run();
  } else {
    db.insert(digestIssues)
      .values({
        id: finalIssueId,
        slug,
        title,
        date: p.weekStart,
        weekOf: weekOfLabel,
        weekStart: p.weekStart,
        synopsis: JSON.stringify(p.synthesis.synopsis ?? []),
        storyCount: p.stories.length,
        jurisdictionCount: new Set(p.stories.map((s) => s.jurisdiction_code)).size,
        readTime: Math.max(5, Math.round(p.stories.length * 1.5)),
        status: "published",
        executiveBrief: p.synthesis.executive_brief,
        coverageGaps: JSON.stringify(p.coverageGaps),
        ingestCostUsd: p.costUsd,
        ingestDurationMs: p.durationMs,
        createdAt: ts,
        updatedAt: ts,
      })
      .run();
  }

  // Write stories.
  const trackerByName = new Map(p.trackerEntries.map((e) => [e.shortName.toLowerCase(), e.id]));
  const writtenStoryIds: string[] = [];

  for (const s of p.stories) {
    const trackerId = s.related_tracker_hint
      ? trackerByName.get(s.related_tracker_hint.toLowerCase()) ?? null
      : null;

    const storyId = generateId();
    db.insert(digestStories)
      .values({
        id: storyId,
        issueId: finalIssueId,
        title: s.title,
        url: s.url,
        source: s.source_name,
        sourceType: mapSourceType(s.source_type),
        date: s.date,
        summary: s.summary,
        takeaways: JSON.stringify(s.takeaways ?? []),
        articleText: s.articleText ?? null,
        jurisdiction: jurisdictionName(s.jurisdiction_code),
        jurisdictionCode: s.jurisdiction_code,
        categories: JSON.stringify(s.categories ?? []),
        contentType: "regulatory",
        lifecycleStage: s.lifecycle_stage,
        urgency: s.urgency,
        impact: s.impact,
        complianceDeadline: s.compliance_deadline ?? null,
        trackerEntryId: trackerId ? validateTrackerId(trackerId) : null,
        sourceChannel: "exa",
        createdAt: ts,
        updatedAt: ts,
      })
      .run();
    writtenStoryIds.push(storyId);
  }

  return { issueId: finalIssueId, storyIds: writtenStoryIds };
}

function validateTrackerId(id: string): string | null {
  const row = db.select({ id: entries.id }).from(entries).where(eq(entries.id, id)).limit(1).all()[0];
  return row?.id ?? null;
}

function mapSourceType(t: string): "regulator" | "law_firm" | "publication" | "court" | "community" {
  if (t === "regulator" || t === "court" || t === "publication" || t === "law_firm") return t;
  return "publication";
}

function jurisdictionName(code: string): string | null {
  const j = JURISDICTION_CONFIGS.find((x) => x.code === code);
  return j?.name ?? code;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function formatWeekOf(weekStart: string, weekEnd: string): string {
  // "20–26 Apr 2026"
  const start = new Date(weekStart + "T00:00:00Z");
  const end = new Date(weekEnd + "T00:00:00Z");
  const sameMonth = start.getUTCMonth() === end.getUTCMonth();
  const month = end.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const year = end.getUTCFullYear();
  if (sameMonth) {
    return `${start.getUTCDate()}–${end.getUTCDate()} ${month} ${year}`;
  }
  const startMonth = start.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  return `${start.getUTCDate()} ${startMonth} – ${end.getUTCDate()} ${month} ${year}`;
}

export function resolveWeekRange(reference: Date = new Date()): { weekStart: string; weekEnd: string } {
  const d = new Date(reference);
  d.setUTCHours(0, 0, 0, 0);
  const day = d.getUTCDay(); // 0 = Sun, 1 = Mon
  const offsetToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() + offsetToMonday);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return {
    weekStart: monday.toISOString().slice(0, 10),
    weekEnd: sunday.toISOString().slice(0, 10),
  };
}

function parseJsonArray<T>(text: string): T[] {
  const cleaned = stripFences(text);
  const start = cleaned.indexOf("[");
  if (start < 0) throw new Error("Could not find JSON array in model output");

  const end = cleaned.lastIndexOf("]");
  if (end > start) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1)) as T[];
    } catch {
      // fall through to truncation recovery
    }
  }
  // Truncation recovery: scan from the array start, collect each balanced
  // top-level object, stop at the first one that fails to parse.
  return recoverJsonArray<T>(cleaned.slice(start));
}

function recoverJsonArray<T>(text: string): T[] {
  // text starts with '['
  const out: T[] = [];
  let i = 1; // skip '['
  while (i < text.length) {
    while (i < text.length && (text[i] === "," || /\s/.test(text[i]))) i++;
    if (i >= text.length || text[i] === "]") break;
    if (text[i] !== "{") break;
    const objStart = i;
    let depth = 0;
    let inStr = false;
    let escape = false;
    let objEnd = -1;
    for (; i < text.length; i++) {
      const c = text[i];
      if (escape) { escape = false; continue; }
      if (inStr) {
        if (c === "\\") escape = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') { inStr = true; continue; }
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) { objEnd = i; i++; break; }
      }
    }
    if (objEnd < 0) break; // truncated mid-object — stop
    try {
      out.push(JSON.parse(text.slice(objStart, objEnd + 1)) as T);
    } catch {
      break;
    }
  }
  return out;
}

function parseJsonObject<T>(text: string): T {
  const cleaned = stripFences(text);
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < 0) {
    throw new Error("Could not find JSON object in model output");
  }
  return JSON.parse(cleaned.slice(start, end + 1)) as T;
}

function stripFences(text: string): string {
  return text.replace(/```(?:json)?\s*/g, "").replace(/```\s*$/g, "").trim();
}
