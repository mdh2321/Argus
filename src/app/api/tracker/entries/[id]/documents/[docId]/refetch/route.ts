import { NextRequest, NextResponse } from "next/server";
import { refreshSourceDocument } from "@/lib/source-refresher";

export const maxDuration = 120;

// Re-fetch a single source document. Used by the doc-list "Retry fetch"
// button when an earlier fetch failed (e.g. Exa-blocked domain before the
// direct fallback existed).
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> }
) {
  const { docId } = await params;
  try {
    const outcome = await refreshSourceDocument(docId);
    const httpStatus =
      outcome.status === "fetch_failed" || outcome.status === "extraction_failed"
        ? 422
        : 200;
    return NextResponse.json(outcome, { status: httpStatus });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
