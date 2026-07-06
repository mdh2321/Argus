import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { entries, entryChanges } from "@/db/schema";
import { eq } from "drizzle-orm";
import { now } from "@/lib/utils";
import { syncDeadlines, computeNextKeyDate } from "@/lib/entry-helpers";

// Approve or dismiss an AI-proposed entry change (A1). Approving applies the
// proposed value to the entry and flips the row to 'applied' — so it becomes a
// genuine, story-sourced entry in the change history — while dismissing simply
// marks it 'dismissed' and leaves the entry untouched. Nothing here ever
// mutates an entry without an explicit approve action.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const action = body.action as "approve" | "dismiss" | undefined;
  if (action !== "approve" && action !== "dismiss") {
    return NextResponse.json({ error: "action must be 'approve' or 'dismiss'" }, { status: 400 });
  }

  const [change] = await db.select().from(entryChanges).where(eq(entryChanges.id, id));
  if (!change) {
    return NextResponse.json({ error: "Change not found" }, { status: 404 });
  }
  if (change.status !== "proposed") {
    return NextResponse.json(
      { error: `Change is already ${change.status}` },
      { status: 409 }
    );
  }

  const ts = now();

  if (action === "dismiss") {
    await db.update(entryChanges).set({ status: "dismissed" }).where(eq(entryChanges.id, id));
    return NextResponse.json({ ok: true, status: "dismissed" });
  }

  // approve — apply the proposed field to the entry.
  const [entry] = await db.select().from(entries).where(eq(entries.id, change.entryId));
  if (!entry) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  }

  const value = change.newValue ?? "";
  const updates: Record<string, unknown> = { updatedAt: ts };
  let syncedKeyDates: string | null = null;

  switch (change.fieldChanged) {
    case "status":
      updates.status = value;
      break;
    case "regulator":
      updates.regulator = value;
      break;
    case "penalties":
      updates.penalties = value;
      break;
    case "key_dates":
      updates.keyDates = value;
      updates.nextKeyDate = computeNextKeyDate(value);
      syncedKeyDates = value;
      break;
    default:
      return NextResponse.json(
        { error: `Cannot apply field '${change.fieldChanged}'` },
        { status: 422 }
      );
  }

  await db.update(entries).set(updates).where(eq(entries.id, change.entryId));
  if (syncedKeyDates !== null) {
    await syncDeadlines(change.entryId, syncedKeyDates);
  }

  // Flip the proposal to an applied change, stamped at approval time so it
  // reads as a real change on the entry's timeline.
  await db
    .update(entryChanges)
    .set({ status: "applied", changedAt: ts })
    .where(eq(entryChanges.id, id));

  return NextResponse.json({ ok: true, status: "applied" });
}
