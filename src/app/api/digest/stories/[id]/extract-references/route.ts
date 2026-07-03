import { NextRequest, NextResponse } from "next/server";
import { extractReferencesForStory } from "@/lib/digest-pipeline/extract-references";

export const maxDuration = 60;

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const refs = await extractReferencesForStory(id);
    return NextResponse.json({
      ok: true,
      storyId: id,
      count: refs.length,
      matched: refs.filter((r) => r.status === "matched").length,
      unmatched: refs.filter((r) => r.status === "unmatched").length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
