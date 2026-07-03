import { NextRequest, NextResponse } from "next/server";
import { parseJsonField } from "@/lib/utils";
import { getTopicBySlug, getTopicMembership, computeTopicStaleness } from "@/lib/topics";

// One topic dossier: stored explainer + live membership + staleness.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const topic = await getTopicBySlug(slug);
  if (!topic) {
    return NextResponse.json({ error: "Topic not found" }, { status: 404 });
  }

  const terms = parseJsonField<string[]>(topic.topicTerms) || [];
  const membership = await getTopicMembership(terms);
  const staleness = computeTopicStaleness(topic.lastGenerated, membership);

  return NextResponse.json({
    topic: {
      id: topic.id,
      slug: topic.slug,
      title: topic.title,
      content: topic.content,
      lastGenerated: topic.lastGenerated,
      generationModel: topic.generationModel,
      terms,
      stale: staleness.stale,
      staleReason: staleness.reason,
    },
    ...membership,
  });
}
