import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { userProfile } from "@/db/schema";
import { eq } from "drizzle-orm";
import { now, parseJsonField, toJsonString } from "@/lib/utils";

function serializeProfile(row: typeof userProfile.$inferSelect) {
  return {
    id: row.id,
    companyName: row.companyName,
    companyDescription: row.companyDescription,
    productsServices: row.productsServices,
    sectors: parseJsonField<string[]>(row.sectors),
    jurisdictionsOfInterest: parseJsonField<string[]>(row.jurisdictionsOfInterest),
    role: row.role,
    focusAreas: parseJsonField<string[]>(row.focusAreas),
    freeText: row.freeText,
    updatedAt: row.updatedAt,
  };
}

export async function GET() {
  const [row] = db
    .select()
    .from(userProfile)
    .where(eq(userProfile.id, "default"))
    .all();

  if (!row) {
    return NextResponse.json({
      profile: {
        id: "default",
        companyName: null,
        companyDescription: null,
        productsServices: null,
        sectors: null,
        jurisdictionsOfInterest: null,
        role: null,
        focusAreas: null,
        freeText: null,
        updatedAt: now(),
      },
    });
  }

  return NextResponse.json({ profile: serializeProfile(row) });
}

export async function PUT(request: NextRequest) {
  const body = await request.json();
  const timestamp = now();

  const values = {
    id: "default",
    companyName: body.companyName ?? null,
    companyDescription: body.companyDescription ?? null,
    productsServices: body.productsServices ?? null,
    sectors: toJsonString(body.sectors ?? null),
    jurisdictionsOfInterest: toJsonString(body.jurisdictionsOfInterest ?? null),
    role: body.role ?? null,
    focusAreas: toJsonString(body.focusAreas ?? null),
    freeText: body.freeText ?? null,
    updatedAt: timestamp,
  };

  // Upsert: try update, if no rows affected, insert
  const result = db
    .update(userProfile)
    .set(values)
    .where(eq(userProfile.id, "default"))
    .run();

  if (result.changes === 0) {
    db.insert(userProfile).values(values).run();
  }

  const [row] = db
    .select()
    .from(userProfile)
    .where(eq(userProfile.id, "default"))
    .all();

  return NextResponse.json({ profile: serializeProfile(row!) });
}
