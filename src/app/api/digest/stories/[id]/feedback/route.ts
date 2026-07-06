import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { digestStories } from "@/db/schema";
import { eq } from "drizzle-orm";
import { appendRelevanceFeedback } from "@/lib/company-context";

// "Not relevant" feedback: appends a dated negative example to the Relevance
// feedback section of data/company-context.md. Every future triage prompt
// carries these as precedents, so rejections compound into better filtering.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";

  const story = db.select().from(digestStories).where(eq(digestStories.id, id)).get();
  if (!story) {
    return NextResponse.json({ error: "Story not found" }, { status: 404 });
  }

  const date = new Date().toISOString().slice(0, 10);
  const line = `[${date}] "${story.title}" (${story.jurisdictionCode ?? "n/a"})${reason ? ` — ${reason}` : ""}`;

  try {
    appendRelevanceFeedback(line);
  } catch (err) {
    console.error("[feedback] append failed:", err);
    return NextResponse.json({ error: "Couldn't write to company context file" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
