import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { digestStories } from "@/db/schema";
import { eq } from "drizzle-orm";
import { appendRelevanceFeedback } from "@/lib/company-context";

// Relevance feedback: appends a dated example to the Relevance feedback section
// of data/company-context.md — negative ("not relevant") or positive ("more
// like this"). Every future triage prompt carries these as precedents, so the
// user's judgements compound into better filtering in both directions.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  const sentiment = body.sentiment === "positive" ? "positive" : "negative";

  const story = db.select().from(digestStories).where(eq(digestStories.id, id)).get();
  if (!story) {
    return NextResponse.json({ error: "Story not found" }, { status: 404 });
  }

  const date = new Date().toISOString().slice(0, 10);
  const marker = sentiment === "positive" ? "\u{1F44D} relevant" : "\u{1F44E} not relevant";
  const line = `[${date}] ${marker}: "${story.title}" (${story.jurisdictionCode ?? "n/a"})${reason ? ` — ${reason}` : ""}`;

  try {
    appendRelevanceFeedback(line);
  } catch (err) {
    console.error("[feedback] append failed:", err);
    return NextResponse.json({ error: "Couldn't write to company context file" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
