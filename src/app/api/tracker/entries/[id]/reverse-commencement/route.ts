import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { entries } from "@/db/schema";
import { eq } from "drizzle-orm";
import { reverseCommencement } from "@/lib/lifecycle";
import { serializeEntry } from "@/lib/entry-helpers";

// Undo a fold-in / supersede that this amendment caused (Gap 8: reversibility).
// Un-archives the amendment, deletes the provenance rows it wrote, clears the
// stale flags it set on parents, and un-retires any predecessor it superseded.
// Non-destructive — obligations were never hard-merged, so the parent's analysis
// is left intact (stale flag cleared) for the user to decide on.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const [existing] = await db.select().from(entries).where(eq(entries.id, id));
  if (!existing) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  }

  const result = await reverseCommencement(id);

  const [updated] = await db.select().from(entries).where(eq(entries.id, id));
  return NextResponse.json({
    entry: serializeEntry(updated),
    restoredParents: result.restoredParents,
    restoredPredecessors: result.restoredPredecessors,
  });
}
