import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { matters, matterItems } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { now } from "@/lib/utils";

export const runtime = "nodejs";

// A matter with its bundled items.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const matter = db.select().from(matters).where(eq(matters.id, id)).get();
  if (!matter) return NextResponse.json({ error: "Matter not found" }, { status: 404 });
  const items = db
    .select()
    .from(matterItems)
    .where(eq(matterItems.matterId, id))
    .orderBy(asc(matterItems.addedAt))
    .all();
  return NextResponse.json({ matter, items });
}

// Update name / description / instructions.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const patch: Record<string, string | null> = { updatedAt: now() };
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
  if (typeof body.description === "string") patch.description = body.description.trim() || null;
  if (typeof body.instructions === "string") patch.instructions = body.instructions.trim() || null;
  db.update(matters).set(patch).where(eq(matters.id, id)).run();
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  db.delete(matterItems).where(eq(matterItems.matterId, id)).run();
  db.delete(matters).where(eq(matters.id, id)).run();
  return NextResponse.json({ ok: true });
}
