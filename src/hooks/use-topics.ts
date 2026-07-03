"use client";

import useSWR from "swr";
import type { TopicEntry, TopicStory, TopicSignal } from "@/lib/topics";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export interface TopicSummary {
  id: string;
  slug: string;
  title: string;
  lastGenerated: string | null;
  stale: boolean;
  staleReason: string | null;
  entryCount: number;
  storyCount: number;
  signalCount: number;
  hasContent: boolean;
}

export interface TopicDossier {
  topic: {
    id: string;
    slug: string;
    title: string;
    content: string;
    lastGenerated: string | null;
    generationModel: string | null;
    terms: string[];
    stale: boolean;
    staleReason: string | null;
  };
  entries: TopicEntry[];
  stories: TopicStory[];
  signals: TopicSignal[];
}

export function useTopics() {
  return useSWR<{ topics: TopicSummary[] }>("/api/topics", fetcher);
}

export function useTopic(slug: string | null) {
  return useSWR<TopicDossier>(slug ? `/api/topics/${slug}` : null, fetcher);
}

export async function regenerateTopic(slug: string) {
  const res = await fetch(`/api/topics/${slug}/generate`, { method: "POST" });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(error.error || "Regeneration failed");
  }
  return res.json();
}
