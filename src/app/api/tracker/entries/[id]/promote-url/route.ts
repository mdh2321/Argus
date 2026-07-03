import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sourceDocuments, entries } from "@/db/schema";
import { eq } from "drizzle-orm";
import { generateId, now, toJsonString } from "@/lib/utils";
import { fetchAndExtract, deriveFetchStatus } from "@/lib/source-fetcher";
import { upgradeSourceUrls } from "@/lib/source-tiers";
import { extractAndStoreTermsForDoc } from "@/lib/defined-terms-ai";

// Promote a URL into a downloaded source document. The URL becomes a real
// sourceDocuments row with full text, so subsequent legal-analysis runs treat
// it as ground truth rather than a bookmark. URLs alone (in entries.sourceUrls)
// can no longer influence AI analysis.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const [entry] = await db.select().from(entries).where(eq(entries.id, id));
  if (!entry) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const url = typeof body?.url === "string" ? body.url.trim() : "";
  if (!url || !/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: "Valid http(s) URL is required" }, { status: 400 });
  }

  // De-dupe: if a source document for this entry already points at this URL,
  // return it instead of creating a duplicate.
  const existing = await db
    .select()
    .from(sourceDocuments)
    .where(eq(sourceDocuments.entryId, id));
  const dup = existing.find((d) => d.sourceUrl === url);
  if (dup) {
    return NextResponse.json({ document: dup, deduped: true }, { status: 200 });
  }

  const fetched = await fetchAndExtract(url);
  if (!fetched.ok) {
    return NextResponse.json(
      {
        error: "Could not fetch URL",
        detail: fetched.error,
      },
      { status: 422 }
    );
  }

  const timestamp = now();
  const docId = generateId();
  const proposedName = fetched.title?.trim() || deriveNameFromUrl(url);

  const doc = {
    id: docId,
    entryId: id,
    name: proposedName,
    sourceUrl: fetched.url,
    fullText: fetched.fullText,
    fileType:
      fetched.extractor === "direct-pdf"
        ? "pdf"
        : fetched.fullText
          ? "html"
          : null,
    charCount: fetched.fullText ? fetched.fullText.length : null,
    addedBy: "manual" as const,
    sourceAuthority: classifyAuthorityFromUrl(fetched.url),
    verifiedUrl: true,
    lastUrlCheck: timestamp,
    contentHash: fetched.contentHash,
    retrievedAt: fetched.fetchedAt,
    fetchStatus: deriveFetchStatus(fetched),
    fetchError: fetched.error,
    extractor: fetched.extractor,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  await db.insert(sourceDocuments).values(doc);

  // Fire-and-forget term extraction in the background.
  if (doc.fullText && doc.fullText.length > 200) {
    void extractAndStoreTermsForDoc(id, {
      id: doc.id,
      name: doc.name,
      fullText: doc.fullText,
    }).catch((err) =>
      console.error(`Background term extraction failed for promoted doc ${doc.id}:`, err)
    );
  }

  // Remove the now-promoted URL from entries.sourceUrls so it stops showing
  // up as an unresolved lead.
  if (entry.sourceUrls) {
    try {
      const parsed = JSON.parse(entry.sourceUrls) as unknown;
      const upgraded = upgradeSourceUrls(parsed) ?? [];
      const filtered = upgraded.filter((s) => s.url !== url && s.url !== fetched.url);
      await db
        .update(entries)
        .set({
          sourceUrls: filtered.length > 0 ? toJsonString(filtered) : null,
          updatedAt: timestamp,
        })
        .where(eq(entries.id, id));
    } catch {
      // If sourceUrls is malformed, leave it alone — promotion still succeeded.
    }
  }

  return NextResponse.json(
    {
      document: doc,
      extracted: fetched.extracted,
      truncated: fetched.truncated,
    },
    { status: 201 }
  );
}

function deriveNameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.split("/").filter(Boolean).pop() ?? "";
    return path ? `${u.hostname} — ${path}` : u.hostname;
  } catch {
    return url;
  }
}

// Best-effort classification from URL pattern. Conservative: only assign
// official_legislation / official_regulator when the host clearly indicates it.
function classifyAuthorityFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.endsWith(".gov.au") || host.endsWith(".gov.sg") || host.endsWith(".govt.nz")) {
      if (host.includes("legislation") || host.includes("austlii") || host.includes("sso.agc.")) {
        return "official_legislation";
      }
      return "official_regulator";
    }
    if (host.endsWith(".gov.hk") || host.endsWith(".gov.in") || host.endsWith(".gov.ph")) {
      return "official_regulator";
    }
    if (host.endsWith(".go.jp")) {
      return "official_regulator";
    }
    if (host.includes("austlii") || host.includes("legislation.")) {
      return "official_legislation";
    }
    if (
      host.endsWith(".edu") ||
      host.endsWith(".edu.au") ||
      host.endsWith(".ac.uk") ||
      host.endsWith(".edu.sg")
    ) {
      return "academic";
    }
    if (
      host.includes("nytimes") ||
      host.includes("reuters") ||
      host.includes("bloomberg") ||
      host.includes("ft.com") ||
      host.includes("wsj.com")
    ) {
      return "news";
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}
