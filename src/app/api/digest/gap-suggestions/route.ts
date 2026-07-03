import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gapSuggestions, digestStories } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { serializeGapSuggestion } from "@/lib/gap-ai";

export async function GET(request: NextRequest) {
  const status = request.nextUrl.searchParams.get("status");

  const rows = status
    ? db
        .select({
          suggestion: gapSuggestions,
          storyTitle: digestStories.title,
        })
        .from(gapSuggestions)
        .leftJoin(digestStories, eq(gapSuggestions.sourceStoryId, digestStories.id))
        .where(eq(gapSuggestions.status, status))
        .orderBy(desc(gapSuggestions.createdAt))
        .all()
    : db
        .select({
          suggestion: gapSuggestions,
          storyTitle: digestStories.title,
        })
        .from(gapSuggestions)
        .leftJoin(digestStories, eq(gapSuggestions.sourceStoryId, digestStories.id))
        .orderBy(desc(gapSuggestions.createdAt))
        .all();

  const suggestions = rows.map((r) =>
    serializeGapSuggestion(r.suggestion, { sourceStoryTitle: r.storyTitle })
  );

  return NextResponse.json({ suggestions, total: suggestions.length });
}
