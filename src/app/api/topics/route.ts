import { NextResponse } from "next/server";
import { db } from "@/db";
import { knowledgeItems } from "@/db/schema";
import { eq, and, ne } from "drizzle-orm";
import { parseJsonField } from "@/lib/utils";
import { getTopicMembership, computeTopicStaleness } from "@/lib/topics";

// Topics wiki index: every topic with live membership counts and computed
// staleness. Counts are queried live, not cached — the corpus is small.
export async function GET() {
  const rows = db
    .select()
    .from(knowledgeItems)
    .where(and(eq(knowledgeItems.itemType, "topic"), ne(knowledgeItems.status, "retired")))
    .all();

  const topics = await Promise.all(
    rows.map(async (row) => {
      const terms = parseJsonField<string[]>(row.topicTerms) || [];
      const membership = await getTopicMembership(terms);
      const staleness = computeTopicStaleness(row.lastGenerated, membership);
      return {
        id: row.id,
        slug: row.slug,
        title: row.title,
        lastGenerated: row.lastGenerated,
        stale: staleness.stale,
        staleReason: staleness.reason,
        entryCount: membership.entries.length,
        storyCount: membership.stories.length,
        signalCount: membership.signals.length,
        hasContent: !!row.content,
      };
    })
  );

  topics.sort((a, b) => b.entryCount - a.entryCount);

  return NextResponse.json({ topics });
}
