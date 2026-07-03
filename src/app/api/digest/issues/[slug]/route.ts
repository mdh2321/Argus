import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { digestIssues, digestStories } from "@/db/schema";
import { eq } from "drizzle-orm";
import { loadReferencesByStoryIds } from "@/lib/digest-pipeline/extract-references";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  const issue = db
    .select()
    .from(digestIssues)
    .where(eq(digestIssues.slug, slug))
    .get();

  if (!issue) {
    return NextResponse.json({ error: "Issue not found" }, { status: 404 });
  }

  const stories = db
    .select()
    .from(digestStories)
    .where(eq(digestStories.issueId, issue.id))
    .all();

  const refsByStoryId = loadReferencesByStoryIds(stories.map((s) => s.id));

  const serializedStories = stories.map((s) => ({
    ...s,
    takeaways: s.takeaways ? JSON.parse(s.takeaways) : [],
    categories: s.categories ? JSON.parse(s.categories) : [],
    tags: s.tags ? JSON.parse(s.tags) : [],
    references: refsByStoryId.get(s.id) ?? [],
  }));

  return NextResponse.json({
    issue: {
      ...issue,
      synopsis: issue.synopsis ? JSON.parse(issue.synopsis) : [],
      complianceScorecard: issue.complianceScorecard ? JSON.parse(issue.complianceScorecard) : null,
      coverageGaps: issue.coverageGaps ? JSON.parse(issue.coverageGaps) : null,
    },
    stories: serializedStories,
  });
}
