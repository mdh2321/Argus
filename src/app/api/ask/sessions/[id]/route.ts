import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { querySessions, queryMessages } from "@/db/schema";
import { eq, asc } from "drizzle-orm";

export const runtime = "nodejs";

// Load one conversation's full message log, oldest first, so the Ask page can
// rehydrate it into Turn[]. `answerJson` is parsed when present (full-fidelity
// re-render); older messages without it fall back to `content` on the client.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const [session] = await db
    .select({ id: querySessions.id })
    .from(querySessions)
    .where(eq(querySessions.id, id));
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const rows = await db
    .select()
    .from(queryMessages)
    .where(eq(queryMessages.sessionId, id))
    .orderBy(asc(queryMessages.createdAt));

  const messages = rows.map((r) => ({
    role: r.role,
    content: r.content,
    citedEntryIds: r.citedEntryIds ? safeParse<string[]>(r.citedEntryIds) : null,
    answer: r.answerJson ? safeParse<unknown>(r.answerJson) : null,
    createdAt: r.createdAt,
  }));

  return NextResponse.json({ id, messages });
}

// Delete a conversation and all its messages. Messages go first — they hold a
// FK to the session.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await db.delete(queryMessages).where(eq(queryMessages.sessionId, id));
  await db.delete(querySessions).where(eq(querySessions.id, id));
  return NextResponse.json({ success: true });
}

function safeParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
