import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { entries } from "@/db/schema";
import { eq } from "drizzle-orm";
import { attachSourcesToEntry } from "@/lib/source-attacher";

export const maxDuration = 120;

interface Body {
  urls: string[];
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await request.json()) as Body;

  if (!Array.isArray(body.urls) || body.urls.length === 0) {
    return NextResponse.json({ error: "urls (non-empty array) required" }, { status: 400 });
  }

  const entry = db.select().from(entries).where(eq(entries.id, id)).get();
  if (!entry) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  }

  const results = await attachSourcesToEntry(id, body.urls);

  return NextResponse.json({
    ok: true,
    approved: results.filter((r) => r.documentId !== null).length,
    results,
  });
}
