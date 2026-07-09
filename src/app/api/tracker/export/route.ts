import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { entries } from "@/db/schema";
import { eq } from "drizzle-orm";
import { serializeEntry } from "@/lib/entry-helpers";

export async function GET(request: NextRequest) {
  const format = request.nextUrl.searchParams.get("format") || "json";

  const rows = await db.select().from(entries).where(eq(entries.archived, false));
  const serialized = rows.map(serializeEntry);

  if (format === "csv") {
    const headers = [
      "id", "jurisdiction", "category", "type", "status", "shortName", "fullName",
      "summary", "applicability", "keyCriteria", "whyItMatters",
      "complianceImplications", "exemptions", "penalties",
      "maxPenaltyValue", "maxPenaltyCurrency", "impactScore", "regulator",
      "nextKeyDate", "relatedContext", "notes", "flagged", "createdAt", "updatedAt",
    ];

    const csvRows = serialized.map((entry) =>
      headers.map((h) => {
        const val = entry[h as keyof typeof entry];
        const str = val === null || val === undefined ? "" : String(val);
        return `"${str.replace(/"/g, '""')}"`;
      }).join(",")
    );

    const csv = [headers.join(","), ...csvRows].join("\n");

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": "attachment; filename=argus-export.csv",
      },
    });
  }

  return NextResponse.json(serialized);
}
