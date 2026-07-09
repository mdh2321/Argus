import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { matters, matterItems } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { generateId, now } from "@/lib/utils";

export const runtime = "nodejs";

// Add an item (entry / story / thread / briefing / …) to a matter. Idempotent
// on (kind, refId) so adding the same record twice is a no-op.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const kind = typeof body.kind === "string" ? body.kind : "";
  // Search results use prefixed ids ("entry:01K…") while detail-page buttons
  // send bare record ids — store bare so matter-scoped Ask can resolve them.
  const rawRefId = typeof body.refId === "string" ? body.refId : "";
  const refId = rawRefId.replace(/^(entry|story|knowledge|signal|thread|briefing):/, "");
  const label = typeof body.label === "string" ? body.label.trim() : "";
  const href = typeof body.href === "string" ? body.href : "";
  if (!kind || !refId || !label || !href) {
    return NextResponse.json({ error: "kind, refId, label and href are required" }, { status: 400 });
  }

  const matter = db.select().from(matters).where(eq(matters.id, id)).get();
  if (!matter) return NextResponse.json({ error: "Matter not found" }, { status: 404 });

  const existing = db
    .select()
    .from(matterItems)
    .where(and(eq(matterItems.matterId, id), eq(matterItems.kind, kind), eq(matterItems.refId, refId)))
    .get();
  if (existing) return NextResponse.json({ id: existing.id, alreadyPresent: true });

  const ts = now();
  const itemId = generateId();
  db.insert(matterItems).values({ id: itemId, matterId: id, kind, refId, label, href, addedAt: ts }).run();
  db.update(matters).set({ updatedAt: ts }).where(eq(matters.id, id)).run();
  return NextResponse.json({ id: itemId }, { status: 201 });
}
