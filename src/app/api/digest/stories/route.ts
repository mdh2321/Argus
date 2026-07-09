import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { digestStories } from "@/db/schema";
import { eq, desc, asc, sql, and } from "drizzle-orm";
import { generateId, now } from "@/lib/utils";
import { loadReferencesByStoryIds, type SerializedReference } from "@/lib/digest-pipeline/extract-references";

function serializeStory(
  s: typeof digestStories.$inferSelect,
  references: SerializedReference[]
) {
  return {
    ...s,
    takeaways: s.takeaways ? JSON.parse(s.takeaways) : [],
    categories: s.categories ? JSON.parse(s.categories) : [],
    tags: s.tags ? JSON.parse(s.tags) : [],
    references,
  };
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const contentType = params.get("contentType");
  const jurisdiction = params.get("jurisdiction");
  const jurisdictionName = params.get("jurisdictionName");
  const category = params.get("category");
  const search = params.get("search");
  const limit = parseInt(params.get("limit") || "50");
  const sortOrder = params.get("order") || "desc";

  const conditions: ReturnType<typeof eq>[] = [];

  if (contentType) {
    conditions.push(eq(digestStories.contentType, contentType));
  }
  if (jurisdiction) {
    conditions.push(eq(digestStories.jurisdictionCode, jurisdiction));
  }
  // Exact match on the jurisdiction display name (e.g. "Singapore") — used by
  // tag drill-downs, where the tag carries the name rather than the code.
  if (jurisdictionName) {
    conditions.push(eq(digestStories.jurisdiction, jurisdictionName));
  }
  // Exact membership in the categories JSON array. Categories are stored as a
  // JSON string like ["AI Governance","Privacy"]; matching the quoted element
  // avoids the false positives a bare title/summary LIKE would produce.
  if (category) {
    conditions.push(sql`${digestStories.categories} LIKE ${'%"' + category + '"%'}`);
  }
  if (params.get("saved") === "true") {
    conditions.push(eq(digestStories.saved, true));
  }
  if (search) {
    conditions.push(
      sql`(${digestStories.title} LIKE ${'%' + search + '%'} OR ${digestStories.summary} LIKE ${'%' + search + '%'})`
    );
  }

  const orderFn = sortOrder === "asc" ? asc : desc;

  const stories = db
    .select()
    .from(digestStories)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(orderFn(digestStories.date))
    .limit(limit)
    .all();

  const refsByStoryId = loadReferencesByStoryIds(stories.map((s) => s.id));

  return NextResponse.json({
    stories: stories.map((s) => serializeStory(s, refsByStoryId.get(s.id) ?? [])),
    total: stories.length,
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const id = generateId();
  const timestamp = now();

  db.insert(digestStories)
    .values({
      id,
      issueId: body.issueId || null,
      title: body.title,
      url: body.url || null,
      source: body.source,
      sourceType: body.sourceType || "publication",
      date: body.date || timestamp.split("T")[0],
      summary: body.summary,
      takeaways: body.takeaways ? JSON.stringify(body.takeaways) : null,
      jurisdiction: body.jurisdiction || null,
      jurisdictionCode: body.jurisdictionCode || null,
      categories: body.categories ? JSON.stringify(body.categories) : null,
      contentType: body.contentType || "regulatory",
      lifecycleStage: body.lifecycleStage || null,
      urgency: body.urgency || null,
      impact: body.impact || null,
      complianceDeadline: body.complianceDeadline || null,
      trackerEntryId: body.trackerEntryId || null,
      featured: body.featured || false,
      tags: body.tags ? JSON.stringify(body.tags) : null,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();

  return NextResponse.json({ id }, { status: 201 });
}
