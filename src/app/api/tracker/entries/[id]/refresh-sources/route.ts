import { NextRequest, NextResponse } from "next/server";
import { refreshSourcesForEntry } from "@/lib/source-refresher";

export const maxDuration = 120;

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const results = await refreshSourcesForEntry(id);
    return NextResponse.json({
      ok: true,
      total: results.length,
      changed: results.filter((r) => r.status === "changed").length,
      unchanged: results.filter((r) => r.status === "unchanged").length,
      failed: results.filter(
        (r) => r.status === "fetch_failed" || r.status === "extraction_failed"
      ).length,
      results,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
