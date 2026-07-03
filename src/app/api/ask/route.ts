import { NextRequest, NextResponse } from "next/server";
import { answerAskSentinel } from "@/lib/ask-server";
import { parseScopes } from "@/lib/ask-request";
import { ensureSession, loadHistory, appendMessage } from "@/lib/ask-sessions";
import { logAgentRun } from "@/lib/agent-runs";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const query = typeof body?.query === "string" ? body.query.trim() : "";
  const incomingSession = typeof body?.sessionId === "string" ? body.sessionId : null;
  const scopes = parseScopes(body);

  if (!query) {
    return NextResponse.json({ error: "Query is required." }, { status: 400 });
  }

  const sessionId = await ensureSession(incomingSession);
  const history = await loadHistory(sessionId);

  const answer = await answerAskSentinel(query, { history, scopes });
  answer.sessionId = sessionId;

  await appendMessage(sessionId, "user", query);
  await appendMessage(
    sessionId,
    "assistant",
    answer.summary,
    answer.citations.map((c) => c.id),
    JSON.stringify(answer)
  );

  await logAgentRun({ workflow: "ask", modelUsed: "claude-sonnet-4-6" });

  return NextResponse.json(answer);
}
