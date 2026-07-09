"use client";

import useSWR from "swr";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

// ── Types (matching API responses) ─────────────────────────────

export interface DigestIssue {
  id: string;
  slug: string;
  title: string;
  date: string;
  weekOf: string;
  weekStart?: string | null;
  synopsis: string[];
  storyCount: number;
  jurisdictionCount: number;
  readTime: number;
  status: string;
  stories: DigestStory[];
  // Pipeline-generated rich content (nullable for legacy issues).
  executiveBrief?: string | null;
  regulatoryRadar?: string | null;
  crossBorderWatch?: string | null;
  regionInsights?: string | null;
  complianceScorecard?: Record<string, unknown> | null;
  coverageGaps?: string[] | null;
  ingestCostUsd?: number | null;
  ingestDurationMs?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface DigestStoryReference {
  id: string;
  storyId: string;
  entryId: string | null;
  text: string;
  charStart: number;
  charEnd: number;
  proposedShortName: string | null;
  proposedFullName: string | null;
  proposedJurisdiction: string | null;
  proposedType: string | null;
  proposedRegulator: string | null;
  proposedCategory: string | null;
  matchConfidence: number | null;
  status: "matched" | "unmatched" | "dismissed";
}

export interface DigestStory {
  id: string;
  issueId: string | null;
  title: string;
  url: string | null;
  source: string;
  sourceType: string;
  date: string;
  summary: string;
  takeaways: string[];
  jurisdiction: string | null;
  jurisdictionCode: string | null;
  categories: string[];
  contentType: string;
  lifecycleStage: string | null;
  urgency: string | null;
  impact: string | null;
  complianceDeadline: string | null;
  trackerEntryId: string | null;
  featured: boolean;
  saved: boolean;
  tags: string[];
  references: DigestStoryReference[];
  createdAt: string;
  updatedAt: string;
}

export interface DigestTagInfo {
  name: string;
  slug: string;
  count: number;
  type: "jurisdiction" | "legal-area" | "content-type";
}

// ── Hooks ──────────────────────────────────────────────────────

export function useDigestIssues(params?: { status?: string; limit?: number; order?: string }) {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set("status", params.status);
  if (params?.limit) searchParams.set("limit", String(params.limit));
  if (params?.order) searchParams.set("order", params.order);
  const key = `/api/digest/issues?${searchParams.toString()}`;
  return useSWR<{ issues: DigestIssue[]; total: number }>(key, fetcher);
}

export function useDigestIssue(slug: string | null) {
  return useSWR<{ issue: DigestIssue; stories: DigestStory[] }>(
    slug ? `/api/digest/issues/${slug}` : null,
    fetcher
  );
}

export function useDigestStories(params?: {
  contentType?: string;
  jurisdiction?: string;
  jurisdictionName?: string;
  category?: string;
  saved?: boolean;
  search?: string;
  limit?: number;
}) {
  const searchParams = new URLSearchParams();
  if (params?.contentType) searchParams.set("contentType", params.contentType);
  if (params?.jurisdiction) searchParams.set("jurisdiction", params.jurisdiction);
  if (params?.jurisdictionName) searchParams.set("jurisdictionName", params.jurisdictionName);
  if (params?.category) searchParams.set("category", params.category);
  if (params?.saved) searchParams.set("saved", "true");
  if (params?.search) searchParams.set("search", params.search);
  if (params?.limit) searchParams.set("limit", String(params.limit));
  const key = `/api/digest/stories?${searchParams.toString()}`;
  return useSWR<{ stories: DigestStory[]; total: number }>(key, fetcher);
}

// One-click star toggle. Callers revalidate their own SWR keys.
export async function setStorySaved(id: string, saved: boolean) {
  const res = await fetch(`/api/digest/stories/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ saved }),
  });
  if (!res.ok) throw new Error("Failed to update story");
  return res.json();
}

export function useDigestTags() {
  return useSWR<{ tags: DigestTagInfo[] }>("/api/digest/tags", fetcher);
}
