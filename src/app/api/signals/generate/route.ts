import { NextResponse } from "next/server";
import { generateSignals } from "@/lib/signals-ai";
import { logAgentRun } from "@/lib/agent-runs";

export async function POST() {
  try {
    const created = await generateSignals();
    await logAgentRun({
      workflow: "signals",
      modelUsed: "claude-sonnet-4-6",
      entriesCreated: created.length,
    });
    return NextResponse.json({ signals: created, generated: created.length });
  } catch (error) {
    console.error("Signal generation failed:", error);
    return NextResponse.json(
      { error: "Signal generation failed", detail: String(error) },
      { status: 500 }
    );
  }
}
