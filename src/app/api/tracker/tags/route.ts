import { NextResponse } from "next/server";
import { db } from "@/db";
import { entries } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  const rows = await db
    .select({ tags: entries.tags })
    .from(entries)
    .where(eq(entries.archived, false));

  const tagCounts: Record<string, number> = {};
  for (const row of rows) {
    if (!row.tags) continue;
    try {
      const tags: string[] = JSON.parse(row.tags);
      for (const tag of tags) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      }
    } catch {
      // skip malformed
    }
  }

  const sorted = Object.entries(tagCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  return NextResponse.json({ tags: sorted });
}
