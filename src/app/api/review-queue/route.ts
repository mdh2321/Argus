import { NextResponse } from "next/server";
import { db } from "@/db";
import { entries, entryChanges, gapSuggestions } from "@/db/schema";
import { and, desc, eq, isNotNull } from "drizzle-orm";

// B1 — the review queue. A read-only aggregation of every pending decision the
// single operator needs to clear: AI-proposed entry changes (A1), stale
// analyses (A2), ungrounded/preliminary entries, and gap/miss suggestions.
// No generation happens here — it's a thin query layer over data already
// stored, so it costs nothing to render.

const FIELD_LABELS: Record<string, string> = {
  status: "Status",
  key_dates: "Key dates",
  regulator: "Regulator",
  penalties: "Penalties",
};

const ITEM_CAP = 6;

interface ReviewItem {
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

interface ReviewGroup {
  key: string;
  label: string;
  count: number;
  href: string; // where the whole group is resolved
  items: ReviewItem[];
}

export async function GET() {
  const groups: ReviewGroup[] = [];

  // 1. Proposed changes (A1) — awaiting approve/dismiss on their entry.
  const proposed = await db
    .select({
      changeId: entryChanges.id,
      field: entryChanges.fieldChanged,
      entryId: entryChanges.entryId,
      shortName: entries.shortName,
    })
    .from(entryChanges)
    .innerJoin(entries, eq(entryChanges.entryId, entries.id))
    .where(eq(entryChanges.status, "proposed"))
    .orderBy(desc(entryChanges.changedAt));
  if (proposed.length > 0) {
    groups.push({
      key: "proposed",
      label: "Proposed changes",
      count: proposed.length,
      href: "/tracker",
      items: proposed.slice(0, ITEM_CAP).map((p) => ({
        id: p.changeId,
        title: p.shortName,
        subtitle: `${FIELD_LABELS[p.field] ?? p.field} update from the digest`,
        href: `/tracker/${p.entryId}`,
      })),
    });
  }

  // 2. Stale analyses (A2) — analysis predates a material change.
  const stale = await db
    .select({ id: entries.id, shortName: entries.shortName, reason: entries.analysisStaleReason })
    .from(entries)
    .where(and(isNotNull(entries.analysisStaleReason), eq(entries.archived, false)))
    .orderBy(desc(entries.updatedAt));
  if (stale.length > 0) {
    groups.push({
      key: "stale",
      label: "Stale analyses",
      count: stale.length,
      href: "/tracker",
      items: stale.slice(0, ITEM_CAP).map((s) => ({
        id: s.id,
        title: s.shortName,
        subtitle: s.reason ?? "Analysis may be out of date",
        href: `/tracker/${s.id}`,
      })),
    });
  }

  // 3. Ungrounded entries — a preliminary sketch awaiting source-grounded upgrade.
  const preliminary = await db
    .select({ id: entries.id, shortName: entries.shortName })
    .from(entries)
    .where(and(eq(entries.summaryDepth, "preliminary"), eq(entries.archived, false)))
    .orderBy(desc(entries.updatedAt));
  if (preliminary.length > 0) {
    groups.push({
      key: "preliminary",
      label: "Ungrounded entries",
      count: preliminary.length,
      href: "/tracker",
      items: preliminary.slice(0, ITEM_CAP).map((e) => ({
        id: e.id,
        title: e.shortName,
        subtitle: "Preliminary — add sources & run full analysis",
        href: `/tracker/${e.id}`,
      })),
    });
  }

  // 4. Gap / miss suggestions — instruments the digest thinks may be untracked.
  const gaps = await db
    .select({
      id: gapSuggestions.id,
      shortName: gapSuggestions.suggestedShortName,
      jurisdiction: gapSuggestions.suggestedJurisdiction,
      category: gapSuggestions.suggestedCategory,
    })
    .from(gapSuggestions)
    .where(eq(gapSuggestions.status, "pending"))
    .orderBy(desc(gapSuggestions.createdAt));
  if (gaps.length > 0) {
    groups.push({
      key: "gaps",
      label: "Possible gaps",
      count: gaps.length,
      href: "/tracker",
      items: gaps.slice(0, ITEM_CAP).map((g) => ({
        id: g.id,
        title: g.shortName,
        subtitle: `${g.jurisdiction} · ${g.category}`,
        href: "/tracker",
      })),
    });
  }

  const total = groups.reduce((sum, g) => sum + g.count, 0);
  return NextResponse.json({ total, groups });
}
