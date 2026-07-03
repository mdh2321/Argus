import { NextRequest, NextResponse } from "next/server";
import { generateComparison } from "@/lib/comparator-ai";

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const topic = typeof body?.topic === "string" ? body.topic.trim() : "";

  if (!topic) {
    return NextResponse.json({ error: "topic is required" }, { status: 400 });
  }
  if (topic.length > 200) {
    return NextResponse.json({ error: "topic too long (200 chars max)" }, { status: 400 });
  }

  try {
    const result = await generateComparison(topic);
    return NextResponse.json(result);
  } catch (err) {
    console.error("Comparison generation failed:", err);
    return NextResponse.json(
      { error: "Comparison generation failed", detail: String(err) },
      { status: 500 }
    );
  }
}
