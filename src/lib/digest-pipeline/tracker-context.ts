import { db } from "@/db";
import { entries, digestIssues, digestStories } from "@/db/schema";
import { desc, eq, ne } from "drizzle-orm";

export interface TrackerContext {
  entriesBlock: string;
  priorDigestBlock: string;
  priorWeekOf: string | null;
  priorStoryShortNames: { id: string; title: string }[];
  trackerShortNames: { id: string; shortName: string }[];
}

const MAX_ENTRIES = 100;
const MAX_PRIOR_STORIES = 20;

export async function buildTrackerContext(): Promise<TrackerContext> {
  // Active tracker entries, most recently updated first.
  const activeEntries = db
    .select({
      id: entries.id,
      jurisdiction: entries.jurisdiction,
      category: entries.category,
      type: entries.type,
      status: entries.status,
      shortName: entries.shortName,
      fullName: entries.fullName,
      summary: entries.summary,
      whyItMatters: entries.whyItMatters,
      impactOnUs: entries.impactOnUs,
      impactOnCustomers: entries.impactOnCustomers,
      nextKeyDate: entries.nextKeyDate,
      impactScore: entries.impactScore,
      regulator: entries.regulator,
      updatedAt: entries.updatedAt,
    })
    .from(entries)
    .where(eq(entries.archived, false))
    .orderBy(desc(entries.updatedAt))
    .limit(MAX_ENTRIES)
    .all();

  const entriesBlock = activeEntries
    .map((e) => {
      const parts = [
        `[${e.id}] ${e.jurisdiction} | ${e.category} | ${e.type} | ${e.status}`,
        `  ${e.shortName} — ${e.fullName}`,
        e.summary ? `  Summary: ${e.summary.slice(0, 280)}` : null,
        e.impactOnUs ? `  Impact on us: ${e.impactOnUs.slice(0, 200)}` : null,
        e.impactOnCustomers ? `  Impact on our customers: ${e.impactOnCustomers.slice(0, 200)}` : null,
        e.regulator ? `  Regulator: ${e.regulator}` : null,
        e.nextKeyDate ? `  Next key date: ${e.nextKeyDate}` : null,
        e.impactScore != null ? `  Impact: ${e.impactScore}/5` : null,
      ].filter(Boolean);
      return parts.join("\n");
    })
    .join("\n\n");

  // Most recent published digest issue + its stories.
  const priorIssue = db
    .select({ id: digestIssues.id, weekOf: digestIssues.weekOf, date: digestIssues.date })
    .from(digestIssues)
    .where(ne(digestIssues.status, "draft"))
    .orderBy(desc(digestIssues.date))
    .limit(1)
    .all()[0];

  let priorDigestBlock = "(no prior digest on record)";
  let priorStoryShortNames: { id: string; title: string }[] = [];
  let priorWeekOf: string | null = null;

  if (priorIssue) {
    priorWeekOf = priorIssue.weekOf;
    const priorStories = db
      .select({
        id: digestStories.id,
        title: digestStories.title,
        jurisdictionCode: digestStories.jurisdictionCode,
        url: digestStories.url,
        summary: digestStories.summary,
      })
      .from(digestStories)
      .where(eq(digestStories.issueId, priorIssue.id))
      .limit(MAX_PRIOR_STORIES)
      .all();

    priorStoryShortNames = priorStories.map((s) => ({ id: s.id, title: s.title }));
    priorDigestBlock = priorStories
      .map((s) => {
        const parts = [
          `- [${s.jurisdictionCode ?? "??"}] ${s.title}`,
          s.url ? `    ${s.url}` : null,
          s.summary ? `    ${s.summary.slice(0, 200)}` : null,
        ].filter(Boolean);
        return parts.join("\n");
      })
      .join("\n");
  }

  const trackerShortNames = activeEntries.map((e) => ({ id: e.id, shortName: e.shortName }));

  return {
    entriesBlock: entriesBlock || "(no active tracker entries)",
    priorDigestBlock,
    priorWeekOf,
    priorStoryShortNames,
    trackerShortNames,
  };
}
