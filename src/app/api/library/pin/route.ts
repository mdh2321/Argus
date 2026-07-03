import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { knowledgeItems } from "@/db/schema";
import { generateId, now } from "@/lib/utils";

// Pin a generated output to the Shelf — an Ask answer ('pinned_answer') or a
// comparator table ('comparison'). The content is stored verbatim: a pinned
// artifact is a frozen point-in-time snapshot, deliberately NOT regenerated.
// That's the contract that distinguishes the Shelf from the Topics wiki.
const PINNABLE_TYPES = ["pinned_answer", "comparison"] as const;
type PinnableType = (typeof PINNABLE_TYPES)[number];

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  const itemType: PinnableType = PINNABLE_TYPES.includes(body?.itemType)
    ? body.itemType
    : "pinned_answer";

  if (!title || !content) {
    return NextResponse.json({ error: "title and content are required" }, { status: 400 });
  }

  const ts = now();
  const id = generateId();
  await db.insert(knowledgeItems).values({
    id,
    slug: `pin-${id.toLowerCase()}`,
    title: title.slice(0, 200),
    itemType,
    content,
    confidence: "medium",
    groundedIn: "mixed",
    lastGenerated: ts,
    staleAfterDays: 36500, // frozen by design — never flagged stale
    status: "current",
    autoRefresh: false,
    createdAt: ts,
    updatedAt: ts,
  });

  return NextResponse.json({ id }, { status: 201 });
}
