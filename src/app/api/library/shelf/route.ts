import { NextResponse } from "next/server";
import { db } from "@/db";
import { knowledgeItems } from "@/db/schema";
import { inArray } from "drizzle-orm";
import { serializeKnowledgeItem } from "@/lib/knowledge-ai";

// The Shelf: frozen, dated artifacts — briefings, pinned Ask answers, and
// comparison tables from /compare. Stamped with generation date, never
// auto-updated. Counterpart to the living Topics wiki.
const SHELF_TYPES = ["briefing", "pinned_answer", "comparison"];

export async function GET() {
  const rows = await db
    .select()
    .from(knowledgeItems)
    .where(inArray(knowledgeItems.itemType, SHELF_TYPES));

  const items = rows
    .map(serializeKnowledgeItem)
    .filter((i) => i.status !== "retired")
    .sort((a, b) =>
      (b.lastGenerated || b.createdAt).localeCompare(a.lastGenerated || a.createdAt)
    );

  return NextResponse.json({ items, total: items.length });
}
