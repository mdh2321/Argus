import "server-only";

import fs from "fs";
import path from "path";

/**
 * Eval-case accumulation (Phase 6.3): every 👎 and every verification failure
 * appends a regression case to evals/ask/cases.jsonl. The tone golden set in
 * evals/ask/ runs from the same corpus of real misses.
 */

export interface AskEvalCase {
  kind: "feedback_down" | "verify_failure";
  createdAt: string;
  query?: string;
  messageId?: string;
  detail: Record<string, unknown>;
}

export function appendEvalCase(entry: AskEvalCase): void {
  try {
    const dir = path.join(process.cwd(), "evals", "ask");
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, "cases.jsonl"), JSON.stringify(entry) + "\n");
  } catch (err) {
    // Eval logging must never break the product path.
    console.error("Ask eval-case append failed:", err);
  }
}
