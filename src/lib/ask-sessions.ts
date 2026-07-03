import "server-only";

import { db } from "@/db";
import { querySessions, queryMessages } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { generateId, now } from "@/lib/utils";
import type { AskMessage } from "@/lib/ask-types";

/**
 * Multi-turn Ask conversations. Persists each question/answer turn to
 * query_sessions / query_messages so follow-up questions ("does that apply to
 * processors?", "what's the penalty?") carry prior context. These tables
 * existed in the schema but nothing read or wrote them until now.
 */

/** Return an existing session id, or create a fresh session and return its id. */
export async function ensureSession(sessionId?: string | null): Promise<string> {
  if (sessionId) {
    const [existing] = db
      .select({ id: querySessions.id })
      .from(querySessions)
      .where(eq(querySessions.id, sessionId))
      .all();
    if (existing) return existing.id;
  }

  const id = generateId();
  const ts = now();
  await db.insert(querySessions).values({ id, createdAt: ts, updatedAt: ts });
  return id;
}

/** Load the conversation history for a session, oldest first. */
export async function loadHistory(sessionId: string): Promise<AskMessage[]> {
  const rows = db
    .select({ role: queryMessages.role, content: queryMessages.content })
    .from(queryMessages)
    .where(eq(queryMessages.sessionId, sessionId))
    .orderBy(asc(queryMessages.createdAt))
    .all();

  return rows
    .filter((r): r is { role: "user" | "assistant"; content: string } =>
      r.role === "user" || r.role === "assistant"
    )
    .map((r) => ({ role: r.role, content: r.content }));
}

/** Append one turn to a session and bump its updatedAt. */
export async function appendMessage(
  sessionId: string,
  role: "user" | "assistant",
  content: string,
  citedEntryIds?: string[],
  answerJson?: string
): Promise<void> {
  const ts = now();
  await db.insert(queryMessages).values({
    id: generateId(),
    sessionId,
    role,
    content,
    citedEntryIds: citedEntryIds && citedEntryIds.length > 0 ? JSON.stringify(citedEntryIds) : null,
    answerJson: answerJson ?? null,
    createdAt: ts,
  });
  await db.update(querySessions).set({ updatedAt: ts }).where(eq(querySessions.id, sessionId));
}
