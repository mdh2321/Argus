import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { matterItems } from "@/db/schema";
import { eq, and } from "drizzle-orm";

export const runtime = "nodejs";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const { id, itemId } = await params;
  db.delete(matterItems)
    .where(and(eq(matterItems.matterId, id), eq(matterItems.id, itemId)))
    .run();
  return NextResponse.json({ ok: true });
}
