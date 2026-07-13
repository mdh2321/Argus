import { NextRequest, NextResponse } from "next/server";
import { answerAskArgus, MODEL_QUICK } from "@/lib/ask-server";
import { parseScopes, parseWebMode } from "@/lib/ask-request";
import { ensureSession, loadHistory, appendMessage, updateAnswerJson } from "@/lib/ask-sessions";
import { logAgentRun } from "@/lib/agent-runs";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const query = typeof body?.query === "string" ? body.query.trim() : "";
  const incomingSession = typeof body?.sessionId === "string" ? body.sessionId : null;
  const scopes = parseScopes(body);
  const web = parseWebMode(body);

  if (!query) {
    return NextResponse.json({ error: "Query is required." }, { status: 400 });
  }

  const sessionId = await ensureSession(incomingSession);
  const history = await loadHistory(sessionId);

  const answer = await answerAskArgus(query, { history, scopes, web });
  answer.sessionId = sessionId;

  await appendMessage(sessionId, "user", query);
  const messageId = await appendMessage(
    sessionId,
    "assistant",
    answer.summary,
    answer.citations.map((c) => c.id),
    JSON.stringify(answer)
  );
  // The stored copy must carry its own id so verification/feedback can key
  // off it after a history reload.
  answer.messageId = messageId;
  await updateAnswerJson(messageId, JSON.stringify(answer));

  await logAgentRun({ workflow: "ask", modelUsed: MODEL_QUICK });

  return NextResponse.json(answer);
}
