import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { digestStories } from "@/db/schema";
import { eq } from "drizzle-orm";
import { now } from "@/lib/utils";
import { loadReferencesByStoryIds } from "@/lib/digest-pipeline/extract-references";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const story = db.select().from(digestStories).where(eq(digestStories.id, id)).get();
  if (!story) {
    return NextResponse.json({ error: "Story not found" }, { status: 404 });
  }

  const refs = loadReferencesByStoryIds([id]).get(id) ?? [];

  return NextResponse.json({
    story: {
      ...story,
      takeaways: story.takeaways ? JSON.parse(story.takeaways) : [],
      categories: story.categories ? JSON.parse(story.categories) : [],
      tags: story.tags ? JSON.parse(story.tags) : [],
      references: refs,
    },
  });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();

  const existing = db.select().from(digestStories).where(eq(digestStories.id, id)).get();
  if (!existing) {
    return NextResponse.json({ error: "Story not found" }, { status: 404 });
  }

  const updates: Record<string, unknown> = { updatedAt: now() };
  const fields = [
    "title", "url", "source", "sourceType", "date", "summary",
    "jurisdiction", "jurisdictionCode", "contentType",
    "lifecycleStage", "urgency", "impact", "complianceDeadline",
    "trackerEntryId", "featured", "saved",
  ] as const;

  for (const field of fields) {
    if (body[field] !== undefined) updates[field] = body[field];
  }
  if (body.takeaways !== undefined) updates.takeaways = JSON.stringify(body.takeaways);
  if (body.categories !== undefined) updates.categories = JSON.stringify(body.categories);
  if (body.tags !== undefined) updates.tags = JSON.stringify(body.tags);

  db.update(digestStories).set(updates).where(eq(digestStories.id, id)).run();

  return NextResponse.json({ success: true });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  db.delete(digestStories).where(eq(digestStories.id, id)).run();
  return NextResponse.json({ success: true });
}
