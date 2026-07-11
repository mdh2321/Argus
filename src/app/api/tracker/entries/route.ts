import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { entries, entryRelationships } from "@/db/schema";
import { eq, and, like, or, gte, lte, desc, asc, inArray, isNull, sql } from "drizzle-orm";
import { generateId, now, toJsonString } from "@/lib/utils";
import { serializeEntry, syncDeadlines, computeNextKeyDate } from "@/lib/entry-helpers";
import { normalizeSourceUrls } from "@/lib/source-tiers";
import { kickOffSummaryGeneration } from "@/lib/summary-pipeline";
import {
  classifyEntry,
  buildSatelliteActivity,
  SATELLITE_ANCHOR_KINDS,
  type AnchorSatellite,
} from "@/lib/anchor-model";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const jurisdiction = params.get("jurisdiction");
  const category = params.get("category");
  const type = params.get("type");
  const status = params.get("status");
  const impactMin = params.get("impact_min");
  const impactMax = params.get("impact_max");
  const search = params.get("search");
  const sortField = params.get("sort") || "updated_at";
  const order = params.get("order") || "desc";
  const page = parseInt(params.get("page") || "1");
  const limit = parseInt(params.get("limit") || "50");
  const flagged = params.get("flagged");
  const depth = params.get("depth");
  // Nested mode groups children under their parents. The list view turns this
  // on when no filters or search are active; cross-cutting views (filtered,
  // searched, "commencing soon") stay flat so urgency doesn't get hidden.
  const nested = params.get("nested") === "1";
  // Anchor-centric view (plan §2.2): return anchors only, each with a satellite
  // activity roll-up. Opt-in — the flat view remains the default.
  const anchored = params.get("anchored") === "1";

  const conditions = [eq(entries.archived, false)];

  if (nested) {
    conditions.push(isNull(entries.parentEntryId));
  }

  if (jurisdiction) {
    const codes = jurisdiction.split(",");
    if (codes.length === 1) {
      conditions.push(eq(entries.jurisdiction, codes[0]));
    } else {
      conditions.push(sql`${entries.jurisdiction} IN (${sql.join(codes.map(c => sql`${c}`), sql`, `)})`);
    }
  }

  if (category) {
    const cats = category.split(",");
    if (cats.length === 1) {
      conditions.push(eq(entries.category, cats[0]));
    } else {
      conditions.push(sql`${entries.category} IN (${sql.join(cats.map(c => sql`${c}`), sql`, `)})`);
    }
  }

  if (type) {
    const types = type.split(",");
    if (types.length === 1) {
      conditions.push(eq(entries.type, types[0]));
    } else {
      conditions.push(sql`${entries.type} IN (${sql.join(types.map(t => sql`${t}`), sql`, `)})`);
    }
  }

  if (status) {
    const statuses = status.split(",");
    if (statuses.length === 1) {
      conditions.push(eq(entries.status, statuses[0]));
    } else {
      conditions.push(sql`${entries.status} IN (${sql.join(statuses.map(s => sql`${s}`), sql`, `)})`);
    }
  }

  if (impactMin) conditions.push(gte(entries.impactScore, parseInt(impactMin)));
  if (impactMax) conditions.push(lte(entries.impactScore, parseInt(impactMax)));
  if (flagged === "true") conditions.push(eq(entries.flagged, true));
  if (depth === "preliminary" || depth === "full") {
    conditions.push(eq(entries.summaryDepth, depth));
  }

  // Awaiting-commencement view: passed legislation with a commencement date
  // landing in the next 90 days. Maps to "what's about to switch on".
  if (params.get("commencing_soon") === "1") {
    const today = new Date().toISOString().slice(0, 10);
    const horizon = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    conditions.push(eq(entries.status, "passed"));
    conditions.push(gte(entries.nextKeyDate, today));
    conditions.push(lte(entries.nextKeyDate, horizon));
  }

  if (search) {
    const term = `%${search}%`;
    conditions.push(
      or(
        like(entries.shortName, term),
        like(entries.fullName, term),
        like(entries.summary, term),
        like(entries.applicability, term),
        like(entries.keyCriteria, term),
        like(entries.whyItMatters, term),
        like(entries.complianceImplications, term),
        like(entries.relatedContext, term)
      )!
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sortMap: Record<string, any> = {
    updated_at: entries.updatedAt,
    created_at: entries.createdAt,
    impact_score: entries.impactScore,
    next_key_date: entries.nextKeyDate,
    jurisdiction: entries.jurisdiction,
    short_name: entries.shortName,
  };
  const sortCol = sortMap[sortField] || entries.updatedAt;
  const orderFn = order === "asc" ? asc : desc;

  const where = and(...conditions);

  const [countResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(entries)
    .where(where);

  const total = countResult.count;
  const offset = (page - 1) * limit;

  // ── Anchor-centric mode (§2.2) ────────────────────────────────────────────
  if (anchored) {
    // Only ~dozens of entries — classify in memory rather than in SQL. Load the
    // filtered set (unpaginated) plus every relationship to classify + roll up.
    const filteredRows = await db.select().from(entries).where(where).orderBy(orderFn(sortCol));
    const allRels = await db
      .select({
        fromEntryId: entryRelationships.fromEntryId,
        toEntryId: entryRelationships.toEntryId,
        kind: entryRelationships.kind,
      })
      .from(entryRelationships);
    const liteRows = await db
      .select({
        id: entries.id,
        type: entries.type,
        status: entries.status,
        updatedAt: entries.updatedAt,
      })
      .from(entries)
      .where(eq(entries.archived, false));

    const outgoing = new Map<string, string[]>();
    for (const r of allRels) {
      const arr = outgoing.get(r.fromEntryId) ?? [];
      arr.push(r.kind);
      outgoing.set(r.fromEntryId, arr);
    }
    const liteById = new Map(liteRows.map((r) => [r.id, r]));

    // satellites grouped under the anchor they link to
    const satsByAnchor = new Map<string, AnchorSatellite[]>();
    for (const r of allRels) {
      if (!SATELLITE_ANCHOR_KINDS.includes(r.kind as (typeof SATELLITE_ANCHOR_KINDS)[number])) continue;
      const sat = liteById.get(r.fromEntryId);
      if (!sat) continue;
      if (classifyEntry(sat.type, outgoing.get(sat.id) ?? []) !== "satellite") continue;
      const arr = satsByAnchor.get(r.toEntryId) ?? [];
      arr.push({ type: sat.type, status: sat.status, updatedAt: sat.updatedAt, kind: r.kind });
      satsByAnchor.set(r.toEntryId, arr);
    }

    const anchorRows = filteredRows.filter(
      (row) => classifyEntry(row.type, outgoing.get(row.id) ?? []) === "anchor"
    );
    const totalAnchors = anchorRows.length;
    const pageAnchors = anchorRows.slice(offset, offset + limit);

    const anchorEntries = pageAnchors.map((row) => ({
      ...serializeEntry(row),
      anchorRole: "anchor" as const,
      satelliteActivity: buildSatelliteActivity(satsByAnchor.get(row.id) ?? []),
    }));

    return NextResponse.json({
      entries: anchorEntries,
      total: totalAnchors,
      page,
      limit,
      totalPages: Math.ceil(totalAnchors / limit),
    });
  }

  const rows = await db
    .select()
    .from(entries)
    .where(where)
    .orderBy(orderFn(sortCol))
    .limit(limit)
    .offset(offset);

  let serialized;
  if (nested) {
    // Inline children for each top-level row. Children are not paginated —
    // a parent always ships with all its kids so the tree stays consistent.
    const parentIds = rows.map((r) => r.id);
    const childRows = parentIds.length
      ? await db
          .select()
          .from(entries)
          .where(
            and(
              eq(entries.archived, false),
              inArray(entries.parentEntryId, parentIds)
            )
          )
          .orderBy(entries.createdAt)
      : [];
    const byParent = new Map<string, typeof childRows>();
    for (const child of childRows) {
      if (!child.parentEntryId) continue;
      const arr = byParent.get(child.parentEntryId) ?? [];
      arr.push(child);
      byParent.set(child.parentEntryId, arr);
    }
    serialized = rows.map((row) => ({
      ...serializeEntry(row),
      children: (byParent.get(row.id) ?? []).map(serializeEntry),
    }));
  } else {
    // Denormalize the primary parent shortName + relationship kind onto child
    // rows so the list can render a typed breadcrumb ("Made under X" /
    // "Amends X" / "Guidance on X") without a second client-side fetch.
    const parentIds = Array.from(
      new Set(rows.map((r) => r.parentEntryId).filter((id): id is string => !!id))
    );
    const parentRows = parentIds.length
      ? await db
          .select({ id: entries.id, shortName: entries.shortName })
          .from(entries)
          .where(inArray(entries.id, parentIds))
      : [];
    const parentMap = new Map(parentRows.map((p) => [p.id, p.shortName]));

    // Look up the relationship kind for each (row, parent) pair from
    // entry_relationships. Falls back to null when the migration hasn't
    // produced a row yet — UI will use a generic "Part of" verb in that case.
    const relRows = parentIds.length
      ? await db
          .select({
            fromEntryId: entryRelationships.fromEntryId,
            toEntryId: entryRelationships.toEntryId,
            kind: entryRelationships.kind,
          })
          .from(entryRelationships)
          .where(
            and(
              inArray(entryRelationships.fromEntryId, rows.map((r) => r.id)),
              inArray(entryRelationships.toEntryId, parentIds)
            )
          )
      : [];
    const kindByPair = new Map<string, string>();
    for (const r of relRows) {
      kindByPair.set(`${r.fromEntryId}::${r.toEntryId}`, r.kind);
    }

    serialized = rows.map((row) => ({
      ...serializeEntry(row),
      parentShortName: row.parentEntryId
        ? parentMap.get(row.parentEntryId) ?? null
        : null,
      parentRelationshipKind: row.parentEntryId
        ? kindByPair.get(`${row.id}::${row.parentEntryId}`) ?? null
        : null,
    }));
  }

  return NextResponse.json({
    entries: serialized,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const timestamp = now();
  const id = generateId();

  const keyDatesJson = body.keyDates ? toJsonString(body.keyDates) : null;
  const nextKeyDate = computeNextKeyDate(keyDatesJson);

  // Normalize sourceUrls: accept string[] or TrackerSource[], always store as TrackerSource[]
  const normalizedSources = normalizeSourceUrls(body.sourceUrls);

  const newEntry = {
    id,
    jurisdiction: body.jurisdiction,
    category: body.category,
    type: body.type,
    status: body.status,
    shortName: body.shortName,
    fullName: body.fullName,
    summary: body.summary || null,
    applicability: body.applicability || null,
    keyCriteria: body.keyCriteria || null,
    whyItMatters: body.whyItMatters || null,
    impactOnUs: body.impactOnUs || null,
    impactOnCustomers: body.impactOnCustomers || null,
    complianceImplications: body.complianceImplications || null,
    exemptions: body.exemptions || null,
    penalties: body.penalties || null,
    maxPenaltyValue: body.maxPenaltyValue || null,
    maxPenaltyCurrency: body.maxPenaltyCurrency || null,
    keyDates: keyDatesJson,
    nextKeyDate,
    impactScore: body.impactScore || null,
    sourceUrls: normalizedSources ? toJsonString(normalizedSources) : null,
    regulator: body.regulator || null,
    relatedEntries: body.relatedEntries ? toJsonString(body.relatedEntries) : null,
    tags: body.tags ? toJsonString(body.tags) : null,
    notes: body.notes || null,
    flagged: body.flagged || false,
    openQuestions: body.openQuestions || null,
    relatedContext: body.relatedContext || null,
    sectionConfidence: body.sectionConfidence ? toJsonString(body.sectionConfidence) : null,
    sectionClaims: body.sectionClaims ? toJsonString(body.sectionClaims) : null,
    parentEntryId: body.parentEntryId || null,
    aiGenerated: body.aiGenerated || false,
    archived: false,
    lastReviewed: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  await db.insert(entries).values(newEntry);
  await syncDeadlines(id, keyDatesJson);

  // Auto-kick a preliminary summary for brand-new entries that didn't ship
  // with summary content. The pipeline detects no source docs and runs the
  // single-shot preliminary path (~30–90s), so a freshly-created entry
  // doesn't sit empty waiting for the user to click Generate Summary.
  // Skipped when the caller already provided summary content (e.g. seeded
  // imports, gap-suggestion approvals that pre-populate the entry).
  if (!newEntry.summary) {
    void kickOffSummaryGeneration(id).catch((err) => {
      console.error(`[create-entry] auto-kickoff failed for ${id}:`, err);
    });
  }

  const [created] = await db.select().from(entries).where(eq(entries.id, id));
  return NextResponse.json(serializeEntry(created), { status: 201 });
}
