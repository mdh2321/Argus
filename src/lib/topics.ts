import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/db";
import { entries, digestStories, digestIssues, signals, knowledgeItems } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { now, parseJsonField, toJsonString } from "@/lib/utils";
import { getProfileContext } from "@/lib/profile-context";
import { logAgentRun } from "@/lib/agent-runs";

// Topics wiki (June 2026 refinement plan B4 + C1). A topic is a
// knowledge_items row with itemType='topic' plus a list of match terms.
// Membership (tracked laws, recent stories, active signals) is ALWAYS
// queried live against those terms — only the synthesized explainer at the
// top of the page is stored, and it is regenerated, never hand-edited.

const MODEL = "claude-sonnet-4-6";
const client = new Anthropic();

// A term matches a value when they're equal case-insensitively, or — for
// terms long enough not to false-positive ("AI" must not match "email") —
// when the value contains the term.
function termMatches(value: string, term: string): boolean {
  const v = value.toLowerCase();
  const t = term.toLowerCase();
  if (v === t) return true;
  return t.length >= 5 && v.includes(t);
}

function anyTermMatches(values: (string | null | undefined)[], terms: string[]): boolean {
  for (const value of values) {
    if (!value) continue;
    for (const term of terms) {
      if (termMatches(value, term)) return true;
    }
  }
  return false;
}

export interface TopicEntry {
  id: string;
  shortName: string;
  jurisdiction: string;
  category: string;
  status: string;
  impactScore: number | null;
  nextKeyDate: string | null;
  impactOnUs: string | null;
  impactOnCustomers: string | null;
  summary: string | null;
  updatedAt: string;
}

export interface TopicStory {
  id: string;
  title: string;
  date: string;
  source: string;
  summary: string;
  jurisdictionCode: string | null;
  issueSlug: string | null;
  url: string | null;
  createdAt: string;
}

export interface TopicSignal {
  id: string;
  title: string;
  summary: string;
  trendDirection: string;
  updatedAt: string;
}

export interface TopicMembership {
  entries: TopicEntry[];
  stories: TopicStory[];
  signals: TopicSignal[];
}

export async function getTopicMembership(terms: string[]): Promise<TopicMembership> {
  const entryRows = await db.select().from(entries).where(eq(entries.archived, false));
  const matchedEntries: TopicEntry[] = entryRows
    .filter((e) => anyTermMatches([e.category, ...(parseJsonField<string[]>(e.tags) || [])], terms))
    .map((e) => ({
      id: e.id,
      shortName: e.shortName,
      jurisdiction: e.jurisdiction,
      category: e.category,
      status: e.status,
      impactScore: e.impactScore,
      nextKeyDate: e.nextKeyDate,
      impactOnUs: e.impactOnUs,
      impactOnCustomers: e.impactOnCustomers,
      summary: e.summary,
      updatedAt: e.updatedAt,
    }))
    .sort((a, b) => (b.impactScore || 0) - (a.impactScore || 0));

  const storyRows = await db
    .select({
      id: digestStories.id,
      title: digestStories.title,
      date: digestStories.date,
      source: digestStories.source,
      summary: digestStories.summary,
      jurisdictionCode: digestStories.jurisdictionCode,
      categories: digestStories.categories,
      tags: digestStories.tags,
      createdAt: digestStories.createdAt,
      url: digestStories.url,
      issueSlug: digestIssues.slug,
    })
    .from(digestStories)
    .leftJoin(digestIssues, eq(digestStories.issueId, digestIssues.id))
    .where(eq(digestStories.contentType, "regulatory"));

  const matchedStories: TopicStory[] = storyRows
    .filter((s) =>
      anyTermMatches(
        [...(parseJsonField<string[]>(s.categories) || []), ...(parseJsonField<string[]>(s.tags) || [])],
        terms
      )
    )
    .map((s) => ({
      id: s.id,
      title: s.title,
      date: s.date,
      source: s.source,
      summary: s.summary,
      jurisdictionCode: s.jurisdictionCode,
      issueSlug: s.issueSlug,
      url: s.url,
      createdAt: s.createdAt,
    }))
    .sort((a, b) => b.date.localeCompare(a.date));

  const signalRows = await db.select().from(signals).where(eq(signals.status, "active"));
  const matchedSignals: TopicSignal[] = signalRows
    .filter((s) => anyTermMatches(parseJsonField<string[]>(s.categories) || [], terms))
    .map((s) => ({
      id: s.id,
      title: s.title,
      summary: s.summary,
      trendDirection: s.trendDirection,
      updatedAt: s.updatedAt,
    }));

  return { entries: matchedEntries, stories: matchedStories, signals: matchedSignals };
}

// A topic page is stale when anything in its live membership moved after the
// explainer was last compiled. Computed on read — no pipeline hook needed,
// so a digest run that touches a topic shows up as staleness immediately.
export function computeTopicStaleness(
  lastGenerated: string | null,
  membership: TopicMembership
): { stale: boolean; reason: string | null } {
  if (!lastGenerated) return { stale: true, reason: "Explainer has not been compiled yet." };
  const newerEntry = membership.entries.find((e) => e.updatedAt > lastGenerated);
  if (newerEntry) return { stale: true, reason: `${newerEntry.shortName} was updated since the last compile.` };
  const newerStory = membership.stories.find((s) => s.createdAt > lastGenerated);
  if (newerStory) return { stale: true, reason: `New story: "${newerStory.title}".` };
  const newerSignal = membership.signals.find((s) => s.updatedAt > lastGenerated);
  if (newerSignal) return { stale: true, reason: `Signal "${newerSignal.title}" moved.` };
  return { stale: false, reason: null };
}

export async function getTopicBySlug(slug: string) {
  return db
    .select()
    .from(knowledgeItems)
    .where(and(eq(knowledgeItems.itemType, "topic"), eq(knowledgeItems.slug, slug)))
    .get();
}

// Regenerate the stored explainer in place. Single model call by design —
// the wiki discipline is cheap, frequent recompiles, not the multi-stage
// adversarial pipeline used for one-off briefings.
export async function regenerateTopicExplainer(slug: string) {
  const topic = await getTopicBySlug(slug);
  if (!topic) throw new Error(`Topic not found: ${slug}`);

  const terms = parseJsonField<string[]>(topic.topicTerms) || [];
  const membership = await getTopicMembership(terms);
  const profileContext = await getProfileContext();

  const entriesBlock = membership.entries
    .map((e) =>
      [
        `- ${e.shortName} (${e.jurisdiction}, ${e.status}${e.impactScore ? `, impact ${e.impactScore}/5` : ""})`,
        e.summary ? `  ${e.summary.slice(0, 400)}` : null,
        e.impactOnUs ? `  For us: ${e.impactOnUs.slice(0, 250)}` : null,
        e.impactOnCustomers ? `  For our customers: ${e.impactOnCustomers.slice(0, 250)}` : null,
        e.nextKeyDate ? `  Next key date: ${e.nextKeyDate}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    )
    .join("\n");

  const storiesBlock = membership.stories
    .slice(0, 20)
    .map((s) => `- [${s.date}] ${s.title} (${s.source}): ${s.summary.slice(0, 250)}`)
    .join("\n");

  const signalsBlock = membership.signals
    .map((s) => `- ${s.title} (${s.trendDirection}): ${s.summary.slice(0, 250)}`)
    .join("\n");

  const prompt = `You are a senior legal intelligence analyst maintaining a living topic page ("${topic.title}") in an internal wiki for an in-house legal team.

${profileContext ? `USER CONTEXT:\n${profileContext}\n\n` : ""}Write the synthesized explainer that sits at the top of the topic page: the current state of play for this topic across the APJ jurisdictions the team tracks (AU, NZ, SG, JP, HK, IN, PH). The reader opens this page to re-orient fast before a meeting.

Compile ONLY from the live platform data below. Do not invent developments that are not in the data; you may use general knowledge to connect and frame what IS in the data.

TRACKED LAWS (live from the tracker):
${entriesBlock || "(none tracked yet)"}

RECENT STORIES (live from the digest, newest first):
${storiesBlock || "(none)"}

ACTIVE SIGNALS:
${signalsBlock || "(none)"}

FORMAT:
- Markdown, 250-450 words.
- Open with a 2-3 sentence "where things stand" paragraph.
- Then "### By jurisdiction" — one tight bullet per jurisdiction that has meaningful activity (flag emoji + jurisdiction name in bold, then the state of play). Skip jurisdictions with nothing.
- Close with "### What to watch" — 2-4 bullets on upcoming dates and likely movement, anchored to actual key dates in the data.
- No title heading (the page supplies it). No preamble. Plain confident prose, paste-ready quality.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2500,
    messages: [{ role: "user", content: prompt }],
  });

  const content = response.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();

  const timestamp = now();
  await db
    .update(knowledgeItems)
    .set({
      content,
      lastGenerated: timestamp,
      status: "current",
      groundedIn: "entries",
      sourceEntryIds: toJsonString(membership.entries.map((e) => e.id)),
      sourceDigestSlugs: toJsonString(
        membership.stories.slice(0, 20).map((s) => (s.issueSlug ? `${s.issueSlug}:${s.id}` : s.id))
      ),
      staleTriggerIds: toJsonString(membership.entries.map((e) => e.id)),
      generationModel: MODEL,
      updatedAt: timestamp,
    })
    .where(eq(knowledgeItems.id, topic.id));

  await logAgentRun({ workflow: "knowledge", modelUsed: MODEL, entriesUpdated: 1 });

  return { content, lastGenerated: timestamp, membership };
}
