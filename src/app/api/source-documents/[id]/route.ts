import { NextResponse } from "next/server";
import { db } from "@/db";
import { sourceDocuments } from "@/db/schema";
import { eq } from "drizzle-orm";

// Citations can point to a source attached to a related instrument. Resolve
// by document identity, never by guessing the currently selected primary text.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [document] = await db.select().from(sourceDocuments).where(eq(sourceDocuments.id, id)).limit(1);
  if (!document) return NextResponse.json({ error: "Source document not found" }, { status: 404 });
  return NextResponse.json({ document });
}
