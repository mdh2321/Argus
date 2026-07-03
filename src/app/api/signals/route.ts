import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { signals } from "@/db/schema";
import { eq } from "drizzle-orm";
import { serializeSignal } from "@/lib/signals-ai";

export async function GET(request: NextRequest) {
  const status = request.nextUrl.searchParams.get("status");

  let rows;
  if (status) {
    rows = db.select().from(signals).where(eq(signals.status, status)).all();
  } else {
    rows = db.select().from(signals).all();
  }

  // Sort by created_at desc
  rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return NextResponse.json({
    signals: rows.map(serializeSignal),
    total: rows.length,
  });
}
