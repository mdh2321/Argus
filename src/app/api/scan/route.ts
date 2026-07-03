import { NextRequest, NextResponse } from "next/server";
import { runLandscapeScan } from "@/lib/scan-ai";
import { interpretScanQuery } from "@/lib/scan-nl";
import { JURISDICTIONS } from "@/lib/constants";
import { logAgentRun } from "@/lib/agent-runs";

export const maxDuration = 300;

const ALL_CODES = JURISDICTIONS.map((j) => j.code);

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      query?: unknown;
      jurisdictions?: unknown;
      categories?: unknown;
      lookbackDays?: unknown;
    };

    const query = typeof body.query === "string" ? body.query.trim() : "";

    let jurisdictions: string[];
    let categories: string[] | undefined;
    let lookbackDays: number | undefined;
    let focus = "";
    let interpretation = "";

    if (query) {
      // Natural-language path: interpret the request into scan parameters.
      // `focus` drives the topical narrowing; we deliberately do NOT pass the
      // interpreted categories as a hard filter, since the per-jurisdiction
      // scanner may file a matching law under a sibling category and we don't
      // want to drop valid hits.
      const interp = await interpretScanQuery(query);
      jurisdictions = interp.jurisdictions.length ? interp.jurisdictions : [...ALL_CODES];
      categories = undefined;
      lookbackDays = interp.lookbackDays;
      focus = interp.focus;
      interpretation = interp.interpretation;
    } else {
      // Structured path (jurisdiction picker).
      jurisdictions = Array.isArray(body.jurisdictions)
        ? (body.jurisdictions as unknown[]).filter((v): v is string => typeof v === "string")
        : [];

      if (jurisdictions.length === 0) {
        return NextResponse.json(
          { error: "Provide a query or a jurisdictions array" },
          { status: 400 }
        );
      }

      categories = Array.isArray(body.categories)
        ? (body.categories as unknown[]).filter((v): v is string => typeof v === "string")
        : undefined;

      lookbackDays =
        typeof body.lookbackDays === "number" && body.lookbackDays > 0
          ? body.lookbackDays
          : undefined;
    }

    const result = await runLandscapeScan({
      jurisdictions,
      categories,
      lookbackDays,
      focus,
    });

    await logAgentRun({
      workflow: "scan",
      modelUsed: "claude-sonnet-4-6",
      entriesCreated: result.suggestions.length,
      sourcesChecked: result.jurisdictionsScanned,
    });

    return NextResponse.json({
      suggestions: result.suggestions,
      generated: result.suggestions.length,
      jurisdictionsScanned: result.jurisdictionsScanned,
      jurisdictionsFailed: result.jurisdictionsFailed,
      interpretation,
      focus,
    });
  } catch (error) {
    console.error("Landscape scan failed:", error);
    return NextResponse.json(
      { error: "Landscape scan failed", detail: String(error) },
      { status: 500 }
    );
  }
}
