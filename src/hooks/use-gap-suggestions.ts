"use client";

import useSWR from "swr";
import type { GapSuggestion } from "@/lib/types";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useGapSuggestions(params?: { status?: string }) {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set("status", params.status);
  const key = `/api/digest/gap-suggestions?${searchParams.toString()}`;
  return useSWR<{ suggestions: GapSuggestion[]; total: number }>(key, fetcher);
}

export async function triggerGenerateGapSuggestions(): Promise<{
  suggestions: GapSuggestion[];
  generated: number;
}> {
  const res = await fetch("/api/digest/gap-suggestions/generate", { method: "POST" });
  if (!res.ok) throw new Error("Failed to generate gap suggestions");
  return res.json();
}

export async function acceptGapSuggestion(id: string): Promise<{ entryId: string }> {
  const res = await fetch(`/api/digest/gap-suggestions/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "accept" }),
  });
  if (!res.ok) throw new Error("Failed to accept suggestion");
  return res.json();
}

export async function dismissGapSuggestion(id: string): Promise<void> {
  const res = await fetch(`/api/digest/gap-suggestions/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "dismiss" }),
  });
  if (!res.ok) throw new Error("Failed to dismiss suggestion");
}

export async function triggerLandscapeScan(input: {
  /** Natural-language request, e.g. "find e-signature laws in Asia". */
  query?: string;
  jurisdictions?: string[];
  categories?: string[];
}): Promise<{
  suggestions: GapSuggestion[];
  generated: number;
  jurisdictionsScanned: string[];
  jurisdictionsFailed: string[];
  interpretation?: string;
  focus?: string;
}> {
  const res = await fetch("/api/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Landscape scan failed${detail ? `: ${detail}` : ""}`);
  }
  return res.json();
}
