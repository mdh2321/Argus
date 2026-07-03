import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { digestIssues, digestStories } from "@/db/schema";
import { eq, desc, asc } from "drizzle-orm";
import { generateId, now } from "@/lib/utils";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const status = params.get("status") || "published";
  const sortOrder = params.get("order") || "desc";
  const limit = parseInt(params.get("limit") || "50");

  const orderFn = sortOrder === "asc" ? asc : desc;

  const issues = db
    .select()
    .from(digestIssues)
    .where(eq(digestIssues.status, status))
    .orderBy(orderFn(digestIssues.date))
    .limit(limit)
    .all();

  const serialized = issues.map((issue) => {
    const stories = db
      .select()
      .from(digestStories)
      .where(eq(digestStories.issueId, issue.id))
      .all()
      .map((s) => ({
        ...s,
        takeaways: s.takeaways ? JSON.parse(s.takeaways) : [],
        categories: s.categories ? JSON.parse(s.categories) : [],
        tags: s.tags ? JSON.parse(s.tags) : [],
      }));

    return {
      ...issue,
      synopsis: issue.synopsis ? JSON.parse(issue.synopsis) : [],
      stories,
    };
  });

  return NextResponse.json({ issues: serialized, total: serialized.length });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const id = generateId();
  const timestamp = now();

  db.insert(digestIssues)
    .values({
      id,
      slug: body.slug,
      title: body.title,
      date: body.date,
      weekOf: body.weekOf,
      synopsis: body.synopsis ? JSON.stringify(body.synopsis) : null,
      storyCount: body.storyCount || 0,
      jurisdictionCount: body.jurisdictionCount || 0,
      readTime: body.readTime || 5,
      status: body.status || "draft",
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();

  return NextResponse.json({ id }, { status: 201 });
}
