import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { digestStories } from "@/db/schema";
import { eq } from "drizzle-orm";
import { draftShare, type ShareFormat } from "@/lib/share-ai";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const format = body.format as ShareFormat;

  if (format !== "linkedin" && format !== "email") {
    return NextResponse.json({ error: "format must be 'linkedin' or 'email'" }, { status: 400 });
  }

  const story = db.select().from(digestStories).where(eq(digestStories.id, id)).get();
  if (!story) {
    return NextResponse.json({ error: "Story not found" }, { status: 404 });
  }

  try {
    const draft = await draftShare(
      {
        title: story.title,
        summary: story.summary,
        takeaways: story.takeaways ? JSON.parse(story.takeaways) : [],
        url: story.url,
        source: story.source,
        jurisdiction: story.jurisdiction,
        impact: story.impact,
        complianceDeadline: story.complianceDeadline,
      },
      format
    );
    return NextResponse.json({ draft });
  } catch (err) {
    console.error("[share] draft failed:", err);
    return NextResponse.json({ error: "Draft generation failed" }, { status: 500 });
  }
}
