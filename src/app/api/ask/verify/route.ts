import { NextRequest, NextResponse } from "next/server";
import { getStoredMessage, updateAnswerJson } from "@/lib/ask-sessions";
import { verifyAnswer } from "@/lib/ask-verify";
import { appendEvalCase } from "@/lib/ask-evals";
import { logAgentRun } from "@/lib/agent-runs";
import { MODEL_MECH } from "@/lib/ask-server";
import type { AskArgusAnswer } from "@/lib/ask-types";

export const runtime = "nodejs";

/**
 * "Verify sources" (Phase 5). Loads the stored answer, runs the Haiku
 * entailment pass claim-by-claim, persists the verdicts into answerJson (so
 * history re-renders them), and returns the updated answer.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const messageId = typeof body?.messageId === "string" ? body.messageId : "";
  if (!messageId) {
    return NextResponse.json({ error: "messageId is required." }, { status: 400 });
  }

  const stored = await getStoredMessage(messageId);
  if (!stored?.answerJson) {
    return NextResponse.json({ error: "No stored answer for that message." }, { status: 404 });
  }

  let answer: AskArgusAnswer;
  try {
    answer = JSON.parse(stored.answerJson) as AskArgusAnswer;
  } catch {
    return NextResponse.json({ error: "Stored answer could not be parsed." }, { status: 500 });
  }
  if (!answer.paragraphs?.length && !answer.reportSections?.length) {
    return NextResponse.json({ error: "This answer has nothing verifiable." }, { status: 422 });
  }

  const outcome = await verifyAnswer(answer);
  await updateAnswerJson(messageId, JSON.stringify(answer));

  // Unsupported/contradicted verdicts are grounding failures — they feed the
  // eval set automatically (Phase 5.4 → 6.3).
  for (const failure of outcome.failures) {
    appendEvalCase({
      kind: "verify_failure",
      createdAt: new Date().toISOString(),
      query: answer.query,
      messageId,
      detail: failure,
    });
  }

  await logAgentRun({ workflow: "ask", modelUsed: MODEL_MECH });

  return NextResponse.json({ answer });
}
