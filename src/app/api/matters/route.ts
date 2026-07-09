import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { matters, matterItems } from "@/db/schema";
import { desc } from "drizzle-orm";
import { generateId, now } from "@/lib/utils";

export const runtime = "nodejs";

// List matters, newest-touched first, each with its item count.
export async function GET() {
  const rows = db.select().from(matters).orderBy(desc(matters.updatedAt)).all();
  const items = db.select({ matterId: matterItems.matterId }).from(matterItems).all();
  const counts = new Map<string, number>();
  for (const it of items) counts.set(it.matterId, (counts.get(it.matterId) ?? 0) + 1);
  return NextResponse.json({
    matters: rows.map((m) => ({ ...m, itemCount: counts.get(m.id) ?? 0 })),
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "A name is required" }, { status: 400 });
  }
  const id = generateId();
  const ts = now();
  db.insert(matters)
    .values({
      id,
      name,
      description: typeof body.description === "string" ? body.description.trim() || null : null,
      instructions: typeof body.instructions === "string" ? body.instructions.trim() || null : null,
      createdAt: ts,
      updatedAt: ts,
    })
    .run();
  return NextResponse.json({ id }, { status: 201 });
}
