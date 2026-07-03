import { NextRequest, NextResponse } from "next/server";
import { regenerateTopicExplainer } from "@/lib/topics";

export const maxDuration = 300;

// Recompile the topic explainer. Synchronous single model call (~15-30s);
// the page shows a spinner and refreshes with the new content + freshness.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  try {
    const result = await regenerateTopicExplainer(slug);
    return NextResponse.json({
      content: result.content,
      lastGenerated: result.lastGenerated,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith("Topic not found")) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    console.error(`[topics] regenerate failed for ${slug}:`, err);
    return NextResponse.json({ error: "Regeneration failed" }, { status: 500 });
  }
}
