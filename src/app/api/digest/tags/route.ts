import { NextResponse } from "next/server";
import { db } from "@/db";
import { digestStories } from "@/db/schema";

interface TagInfo {
  name: string;
  slug: string;
  count: number;
  type: "jurisdiction" | "legal-area" | "content-type";
}

export async function GET() {
  const stories = db.select().from(digestStories).all();

  const tagCounts: Record<string, { count: number; type: TagInfo["type"] }> = {};

  for (const story of stories) {
    // Jurisdiction tags
    if (story.jurisdiction) {
      tagCounts[story.jurisdiction] = tagCounts[story.jurisdiction] || { count: 0, type: "jurisdiction" };
      tagCounts[story.jurisdiction].count++;
    }

    // Category tags
    const categories: string[] = story.categories ? JSON.parse(story.categories) : [];
    for (const cat of categories) {
      tagCounts[cat] = tagCounts[cat] || { count: 0, type: "legal-area" };
      tagCounts[cat].count++;
    }

    // Content type tags (for pulse items)
    if (story.contentType !== "regulatory") {
      const label = story.contentType.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      tagCounts[label] = tagCounts[label] || { count: 0, type: "content-type" };
      tagCounts[label].count++;
    }
  }

  const tags: TagInfo[] = Object.entries(tagCounts)
    .map(([name, info]) => ({
      name,
      slug: encodeURIComponent(name.toLowerCase()),
      count: info.count,
      type: info.type,
    }))
    .sort((a, b) => b.count - a.count);

  return NextResponse.json({ tags });
}
