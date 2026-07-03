import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { digestStories, digestIssues, storyReferences } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";

// "In the news" — the digest stories that referenced this entry, newest
// first. Reverses the story→entry reference links (refinement plan B3): the
// entry page becomes canonical summary + business relevance + recent
// narrative history. Two link sources, merged:
//   1. story_references rows with status='matched' pointing at this entry
//   2. digest_stories.tracker_entry_id (the original flywheel link)
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const refRows = db
    .select({ storyId: storyReferences.storyId })
    .from(storyReferences)
    .where(and(eq(storyReferences.entryId, id), eq(storyReferences.status, "matched")))
    .all();

  const directRows = db
    .select({ id: digestStories.id })
    .from(digestStories)
    .where(eq(digestStories.trackerEntryId, id))
    .all();

  const storyIds = [...new Set([...refRows.map((r) => r.storyId), ...directRows.map((r) => r.id)])];
  if (storyIds.length === 0) {
    return NextResponse.json({ stories: [] });
  }

  const rows = db
    .select({
      id: digestStories.id,
      title: digestStories.title,
      date: digestStories.date,
      source: digestStories.source,
      sourceType: digestStories.sourceType,
      summary: digestStories.summary,
      url: digestStories.url,
      jurisdictionCode: digestStories.jurisdictionCode,
      impact: digestStories.impact,
      issueSlug: digestIssues.slug,
      issueTitle: digestIssues.title,
    })
    .from(digestStories)
    .leftJoin(digestIssues, eq(digestStories.issueId, digestIssues.id))
    .where(inArray(digestStories.id, storyIds))
    .all();

  rows.sort((a, b) => b.date.localeCompare(a.date));

  return NextResponse.json({ stories: rows });
}
