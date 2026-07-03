import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { knowledgeItems } from "@/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { serializeKnowledgeItem } from "@/lib/knowledge-ai";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const jurisdiction = params.get("jurisdiction");

  const conditions = [eq(knowledgeItems.itemType, "briefing")];
  if (jurisdiction) conditions.push(eq(knowledgeItems.jurisdiction, jurisdiction));

  const rows = await db
    .select()
    .from(knowledgeItems)
    .where(and(...conditions))
    .orderBy(desc(knowledgeItems.periodTo));

  const items = rows.map(serializeKnowledgeItem);

  return NextResponse.json({ briefings: items, total: items.length });
}
