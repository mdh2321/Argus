import { NextRequest, NextResponse } from "next/server";
import { kickOffSummaryGeneration } from "@/lib/summary-pipeline";

export const maxDuration = 600;

// Thin HTTP wrapper around the summary pipeline. The actual fire-and-forget
// background-job logic lives in lib/summary-pipeline.ts so creation paths
// can also kick off a preliminary analysis without going through HTTP.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const result = await kickOffSummaryGeneration(id);
    if (result.status === "already_running") {
      return NextResponse.json(
        {
          status: "running",
          startedAt: result.startedAt,
          message: "A summary generation is already in progress for this entry.",
        },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { status: "running", startedAt: result.startedAt },
      { status: 202 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("not found")) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
