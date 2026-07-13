import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { askFeedback } from "@/db/schema";
import { desc, gte } from "drizzle-orm";
import { generateId, now } from "@/lib/utils";
import { appendEvalCase } from "@/lib/ask-evals";
import type { AskFeedbackReason } from "@/lib/ask-types";

export const runtime = "nodejs";

const VALID_REASONS: AskFeedbackReason[] = [
  "wrong_sources",
  "missed_source",
  "too_long",
  "tone",
  "outdated",
  "hallucination",
];

/** Record a 👍/👎 on an answer. 👎 also appends an eval regression case. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const messageId = typeof body?.messageId === "string" ? body.messageId.trim() : "";
  const rating = body?.rating === "up" || body?.rating === "down" ? body.rating : null;
  if (!messageId || !rating) {
    return NextResponse.json({ error: "messageId and rating are required." }, { status: 400 });
  }

  const reasons = Array.isArray(body?.reasons)
    ? (body.reasons as unknown[]).filter((r): r is AskFeedbackReason =>
        VALID_REASONS.includes(r as AskFeedbackReason)
      )
    : [];
  const comment = typeof body?.comment === "string" ? body.comment.slice(0, 2000) : null;
  const query = typeof body?.query === "string" ? body.query.slice(0, 2000) : null;
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId : null;

  await db.insert(askFeedback).values({
    id: generateId(),
    messageId,
    sessionId,
    rating,
    reasons: reasons.length > 0 ? JSON.stringify(reasons) : null,
    comment,
    query,
    createdAt: now(),
  });

  if (rating === "down") {
    appendEvalCase({
      kind: "feedback_down",
      createdAt: new Date().toISOString(),
      query: query ?? undefined,
      messageId,
      detail: { reasons, comment },
    });
  }

  return NextResponse.json({ ok: true });
}

/** Last-30-days feedback summary — the review surface for prompt/retrieval tuning. */
export async function GET(request: NextRequest) {
  const days = Math.min(Number(request.nextUrl.searchParams.get("days")) || 30, 365);
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const rows = db
    .select()
    .from(askFeedback)
    .where(gte(askFeedback.createdAt, cutoff))
    .orderBy(desc(askFeedback.createdAt))
    .all();

  const byReason: Record<string, number> = {};
  let up = 0;
  let down = 0;
  for (const row of rows) {
    if (row.rating === "up") up++;
    else down++;
    if (row.reasons) {
      for (const reason of JSON.parse(row.reasons) as string[]) {
        byReason[reason] = (byReason[reason] || 0) + 1;
      }
    }
  }

  return NextResponse.json({
    days,
    up,
    down,
    byReason,
    recent: rows.slice(0, 50).map((r) => ({
      rating: r.rating,
      reasons: r.reasons ? JSON.parse(r.reasons) : [],
      comment: r.comment,
      query: r.query,
      createdAt: r.createdAt,
    })),
  });
}
