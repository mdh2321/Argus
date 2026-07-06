import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { entries } from "@/db/schema";
import { eq } from "drizzle-orm";
import { attachSourcesToEntry } from "@/lib/source-attacher";
import { kickOffSummaryGeneration } from "@/lib/summary-pipeline";

export const maxDuration = 120;

interface Body {
  urls: string[];
  // A3 — when true, immediately kick off a full analysis once sources attach,
  // so verifying sources and running analysis is a single action. The deliberate
  // human step is judging the sources, not remembering to press a second button.
  thenAnalyze?: boolean;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await request.json()) as Body;

  if (!Array.isArray(body.urls) || body.urls.length === 0) {
    return NextResponse.json({ error: "urls (non-empty array) required" }, { status: 400 });
  }

  const entry = db.select().from(entries).where(eq(entries.id, id)).get();
  if (!entry) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  }

  const results = await attachSourcesToEntry(id, body.urls);
  const approved = results.filter((r) => r.documentId !== null).length;

  // Kick off analysis only if at least one source actually attached, otherwise
  // the run would silently degrade to a preliminary (ungrounded) sketch.
  let analyzing = false;
  if (body.thenAnalyze && approved > 0) {
    const kick = await kickOffSummaryGeneration(id);
    // Either a fresh run started or one was already in flight — both mean the
    // entry is now being analyzed.
    analyzing = kick.status === "running" || kick.status === "already_running";
  }

  return NextResponse.json({
    ok: true,
    approved,
    analyzing,
    results,
  });
}
