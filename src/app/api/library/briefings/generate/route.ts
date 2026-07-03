import { NextRequest, NextResponse } from "next/server";
import { generateBriefing } from "@/lib/knowledge-ai";
import { logAgentRun } from "@/lib/agent-runs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { periodFrom, periodTo, jurisdiction, category } = body;

    if (!periodFrom || !periodTo) {
      return NextResponse.json(
        { error: "periodFrom and periodTo are required (YYYY-MM-DD)" },
        { status: 400 }
      );
    }

    const item = await generateBriefing({
      periodFrom,
      periodTo,
      jurisdiction: jurisdiction || undefined,
      category: category || undefined,
    });

    await logAgentRun({
      workflow: "briefing",
      modelUsed: "claude-sonnet-4-6",
      entriesCreated: 1,
    });

    return NextResponse.json({ briefing: item }, { status: 201 });
  } catch (error) {
    console.error("Briefing generation failed:", error);
    return NextResponse.json(
      { error: "Failed to generate briefing" },
      { status: 500 }
    );
  }
}
