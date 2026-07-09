import { NextResponse } from "next/server";
import { db } from "@/db";
import { queryMessages } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { ensureSession, appendMessage } from "@/lib/ask-sessions";

export const runtime = "nodejs";

// Fork a conversation: copy an existing session's messages into a fresh
// session and return its id. The branch inherits the thread's full context, so
// a follow-up can spin off a new line of inquiry without disturbing (or being
// disturbed by) the original — how legal research actually branches.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const rows = await db
    .select()
    .from(queryMessages)
    .where(eq(queryMessages.sessionId, id))
    .orderBy(asc(queryMessages.createdAt));

  if (rows.length === 0) {
    return NextResponse.json({ error: "Nothing to fork" }, { status: 404 });
  }

  const newId = await ensureSession(null);
  for (const m of rows) {
    if (m.role !== "user" && m.role !== "assistant") continue;
    const cited = m.citedEntryIds ? (JSON.parse(m.citedEntryIds) as string[]) : undefined;
    await appendMessage(newId, m.role, m.content, cited, m.answerJson ?? undefined);
  }

  return NextResponse.json({ id: newId });
}
