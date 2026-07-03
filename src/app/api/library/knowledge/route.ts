import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { knowledgeItems } from "@/db/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import { serializeKnowledgeItem } from "@/lib/knowledge-ai";
import type { KnowledgeItemType } from "@/lib/types";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const itemType = params.get("type") as KnowledgeItemType | null;
  const status = params.get("status");
  const jurisdiction = params.get("jurisdiction");

  const conditions = [];
  if (itemType) conditions.push(eq(knowledgeItems.itemType, itemType));
  if (status) conditions.push(eq(knowledgeItems.status, status));
  if (jurisdiction) conditions.push(eq(knowledgeItems.jurisdiction, jurisdiction));

  // Exclude briefings from general listing unless explicitly requested
  if (!itemType) {
    conditions.push(sql`${knowledgeItems.itemType} != 'briefing'`);
  }

  const rows = await db
    .select()
    .from(knowledgeItems)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(knowledgeItems.updatedAt));

  const items = rows.map(serializeKnowledgeItem);

  return NextResponse.json({ items, total: items.length });
}

// June 2026 library rebuild (C3): freestanding knowledge-item creation was
// cut. The library is exactly two things now — the topics wiki (seeded via
// scripts/seed-topics.ts, compiled via /api/topics/[slug]/generate) and the
// shelf (briefings via /api/library/briefings/generate, pinned answers via
// /api/library/pin, comparator outputs once A4 ships). Existing rows of the
// old types still render; they just can't be created anymore.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const cutTypes: KnowledgeItemType[] = ["concept", "comparison", "entity", "trend"];
  if (cutTypes.includes(body?.itemType)) {
    return NextResponse.json(
      { error: `itemType '${body.itemType}' was removed in the library rebuild. Use a topic page (wiki) or a shelf artifact instead.` },
      { status: 410 }
    );
  }
  return NextResponse.json(
    { error: "Unsupported itemType. Briefings: POST /api/library/briefings/generate. Pins: POST /api/library/pin. Topics: POST /api/topics/[slug]/generate." },
    { status: 400 }
  );
}
