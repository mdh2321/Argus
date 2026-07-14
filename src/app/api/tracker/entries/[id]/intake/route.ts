import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { entries, intakeCandidates } from "@/db/schema";
import { eq } from "drizzle-orm";
import { now } from "@/lib/utils";
import { attachSourcesToEntry } from "@/lib/source-attacher";
import { kickOffSummaryGeneration } from "@/lib/summary-pipeline";

export const maxDuration = 120;

// GET — intake state for the entry page's intake panel. Polled while the
// pipeline runs; also serves the provenance trail afterwards.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const entry = db
    .select({
      intakeStatus: entries.intakeStatus,
      intakeError: entries.intakeError,
      intakeStartedAt: entries.intakeStartedAt,
      summaryStatus: entries.summaryStatus,
      summaryDepth: entries.summaryDepth,
    })
    .from(entries)
    .where(eq(entries.id, id))
    .get();
  if (!entry) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  }

  const candidates = db
    .select()
    .from(intakeCandidates)
    .where(eq(intakeCandidates.entryId, id))
    .all();

  return NextResponse.json({
    intakeStatus: entry.intakeStatus,
    intakeError: entry.intakeError,
    intakeStartedAt: entry.intakeStartedAt,
    summaryStatus: entry.summaryStatus,
    summaryDepth: entry.summaryDepth,
    candidates,
  });
}

interface PatchBody {
  candidateIds: string[];
  action: "approve" | "dismiss";
  // approve only — kick a full analysis once the docs attach.
  thenAnalyze?: boolean;
}

// PATCH — resolve held candidates. Approve fetches + attaches the documents
// (human judgment overrides the match check's hesitation); dismiss buries them.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as PatchBody | null;

  if (!body || !Array.isArray(body.candidateIds) || body.candidateIds.length === 0) {
    return NextResponse.json({ error: "candidateIds (non-empty array) required" }, { status: 400 });
  }
  if (body.action !== "approve" && body.action !== "dismiss") {
    return NextResponse.json({ error: "action must be 'approve' or 'dismiss'" }, { status: 400 });
  }

  const entry = db.select().from(entries).where(eq(entries.id, id)).get();
  if (!entry) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  }

  const rows = db
    .select()
    .from(intakeCandidates)
    .where(eq(intakeCandidates.entryId, id))
    .all()
    .filter((c) => body.candidateIds.includes(c.id) && c.status === "held");

  if (rows.length === 0) {
    return NextResponse.json({ error: "No held candidates matched" }, { status: 404 });
  }

  const ts = now();

  if (body.action === "dismiss") {
    for (const c of rows) {
      db.update(intakeCandidates)
        .set({ status: "dismissed", decidedBy: "human", updatedAt: ts })
        .where(eq(intakeCandidates.id, c.id))
        .run();
    }
    return NextResponse.json({ ok: true, dismissed: rows.length });
  }

  // Approve: fetch + attach, then record the outcome per candidate.
  const results = await attachSourcesToEntry(id, rows.map((c) => c.url));
  let approved = 0;
  for (const c of rows) {
    const result = results.find((r) => r.url === c.url);
    // "Already attached" reports documentId=null but is still a success from
    // the user's point of view — the doc exists on the entry.
    const attached = !!result && (result.documentId !== null || result.error === "Already attached to this entry");
    if (attached) approved++;
    db.update(intakeCandidates)
      .set({
        status: attached ? "attached" : "held",
        decidedBy: attached ? "human" : null,
        documentId: result?.documentId ?? null,
        evidence: attached ? c.evidence : `Attach failed — ${result?.error ?? "unknown error"}`,
        updatedAt: ts,
      })
      .where(eq(intakeCandidates.id, c.id))
      .run();
  }

  let analyzing = false;
  if (body.thenAnalyze && approved > 0) {
    const kick = await kickOffSummaryGeneration(id);
    analyzing = kick.status === "running" || kick.status === "already_running";
  }

  return NextResponse.json({ ok: true, approved, analyzing, results });
}
