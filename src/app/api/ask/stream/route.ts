import { NextRequest } from "next/server";
import { streamDeepReport, streamConversationalAnswer, MODEL_QUICK, MODEL_DEEP } from "@/lib/ask-server";
import { parseScopes, parseWebMode, isNewsConversation } from "@/lib/ask-request";
import { ensureSession, loadHistory, appendMessage, updateAnswerJson } from "@/lib/ask-sessions";
import { logAgentRun } from "@/lib/agent-runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-Sent Events endpoint for streamed Ask answers. Two shapes:
 *   • deep reports — `stage` + `progress` events while the model works, then `done`.
 *   • news-story conversational Q&A — `delta` text events as it streams, then
 *     `done` with the web-grounded answer + checkable source links.
 * Both keep the UI live while the model works.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const query = typeof body?.query === "string" ? body.query.trim() : "";
  const incomingSession = typeof body?.sessionId === "string" ? body.sessionId : null;
  const scopes = parseScopes(body);
  const web = parseWebMode(body);
  const conversational = isNewsConversation(scopes);

  if (!query) {
    return new Response(JSON.stringify({ error: "Query is required." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const sessionId = await ensureSession(incomingSession);
  const history = await loadHistory(sessionId);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));

      try {
        if (conversational) {
          for await (const event of streamConversationalAnswer(query, { history, scopes, web })) {
            if (event.type === "done") {
              event.answer.sessionId = sessionId;
              await appendMessage(sessionId, "user", query);
              const messageId = await appendMessage(
                sessionId,
                "assistant",
                event.answer.content,
                event.answer.citations.map((c) => c.id),
                JSON.stringify(event.answer)
              );
              // The stored copy must carry its own id so verification and
              // feedback can key off it after a history reload.
              event.answer.messageId = messageId;
              await updateAnswerJson(messageId, JSON.stringify(event.answer));
              await logAgentRun({ workflow: "ask", modelUsed: MODEL_QUICK });
            }
            send(event);
          }
        } else {
          for await (const event of streamDeepReport(query, { history, scopes, web })) {
            if (event.type === "done") {
              event.answer.sessionId = sessionId;
              await appendMessage(sessionId, "user", query);
              const messageId = await appendMessage(
                sessionId,
                "assistant",
                event.answer.summary,
                event.answer.citations.map((c) => c.id),
                JSON.stringify(event.answer)
              );
              event.answer.messageId = messageId;
              await updateAnswerJson(messageId, JSON.stringify(event.answer));
              await logAgentRun({ workflow: "ask", modelUsed: MODEL_DEEP });
            }
            send(event);
          }
        }
      } catch (err) {
        console.error("Ask stream route failed:", err);
        send({ type: "error", message: "The answer stream failed." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
