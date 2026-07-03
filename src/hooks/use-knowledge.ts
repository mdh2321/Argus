"use client";

import useSWR from "swr";
import type { KnowledgeItem, KnowledgeItemWithClaims, KnowledgeItemType } from "@/lib/types";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useKnowledgeItems(params?: { type?: KnowledgeItemType; status?: string; jurisdiction?: string }) {
  const searchParams = new URLSearchParams();
  if (params?.type) searchParams.set("type", params.type);
  if (params?.status) searchParams.set("status", params.status);
  if (params?.jurisdiction) searchParams.set("jurisdiction", params.jurisdiction);
  const key = `/api/library/knowledge?${searchParams.toString()}`;
  return useSWR<{ items: KnowledgeItem[]; total: number }>(key, fetcher);
}

export function useKnowledgeItem(id: string | null) {
  return useSWR<{ item: KnowledgeItemWithClaims }>(id ? `/api/library/knowledge/${id}` : null, fetcher);
}

export function useBriefings(jurisdiction?: string) {
  const searchParams = new URLSearchParams();
  if (jurisdiction) searchParams.set("jurisdiction", jurisdiction);
  const key = `/api/library/briefings?${searchParams.toString()}`;
  return useSWR<{ briefings: KnowledgeItem[]; total: number }>(key, fetcher);
}

export async function generateKnowledgeItem(data: {
  title: string;
  itemType: KnowledgeItemType;
  jurisdiction?: string;
  category?: string;
  entryIds?: string[];
  customInstructions?: string;
}) {
  const res = await fetch("/api/library/knowledge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(error.error || "Failed to generate knowledge item");
  }
  return res.json();
}

export async function generateBriefing(data: {
  periodFrom: string;
  periodTo: string;
  jurisdiction?: string;
  category?: string;
}) {
  const res = await fetch("/api/library/briefings/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(error.error || "Failed to generate briefing");
  }
  return res.json();
}

export async function verifyKnowledgeItem(id: string) {
  const res = await fetch(`/api/library/knowledge/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ verified: true }),
  });
  if (!res.ok) throw new Error("Failed to verify");
  return res.json();
}

export async function deleteKnowledgeItem(id: string) {
  const res = await fetch(`/api/library/knowledge/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete");
  return res.json();
}
