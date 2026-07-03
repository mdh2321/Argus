import { NextResponse } from "next/server";
import { db } from "@/db";
import { querySessions, queryMessages } from "@/db/schema";
import { desc, asc, inArray } from "drizzle-orm";

export const runtime = "nodejs";

// List past Ask conversations newest-first, each summarised by its first
// question (the title) and how many turns it contains. Backs the History
// drawer on the Ask page. Sessions with no messages (created but abandoned
// before a question landed) are omitted.
export async function GET() {
  const sessions = await db
    .select({ id: querySessions.id, updatedAt: querySessions.updatedAt })
    .from(querySessions)
    .orderBy(desc(querySessions.updatedAt))
    .limit(200);

  if (sessions.length === 0) {
    return NextResponse.json({ sessions: [] });
  }

  const ids = sessions.map((s) => s.id);
  const messages = await db
    .select({
      sessionId: queryMessages.sessionId,
      role: queryMessages.role,
      content: queryMessages.content,
      createdAt: queryMessages.createdAt,
    })
    .from(queryMessages)
    .where(inArray(queryMessages.sessionId, ids))
    .orderBy(asc(queryMessages.createdAt));

  // First user message → title; count of user turns → turn count.
  const firstQuestion = new Map<string, string>();
  const turnCount = new Map<string, number>();
  for (const m of messages) {
    if (m.role !== "user") continue;
    turnCount.set(m.sessionId, (turnCount.get(m.sessionId) ?? 0) + 1);
    if (!firstQuestion.has(m.sessionId)) firstQuestion.set(m.sessionId, m.content);
  }

  const result = sessions
    .filter((s) => firstQuestion.has(s.id))
    .map((s) => ({
      id: s.id,
      updatedAt: s.updatedAt,
      title: firstQuestion.get(s.id)!.slice(0, 140),
      turns: turnCount.get(s.id) ?? 0,
    }));

  return NextResponse.json({ sessions: result });
}
