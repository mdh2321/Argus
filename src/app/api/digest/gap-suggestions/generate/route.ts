import { NextResponse } from "next/server";
import { generateGapSuggestions } from "@/lib/gap-ai";
import { logAgentRun } from "@/lib/agent-runs";

export async function POST() {
  try {
    const created = await generateGapSuggestions();
    await logAgentRun({
      workflow: "gap",
      modelUsed: "claude-sonnet-4-6",
      entriesCreated: created.length,
    });
    return NextResponse.json({ suggestions: created, generated: created.length });
  } catch (error) {
    console.error("Gap suggestion generation failed:", error);
    return NextResponse.json(
      { error: "Gap suggestion generation failed", detail: String(error) },
      { status: 500 }
    );
  }
}
