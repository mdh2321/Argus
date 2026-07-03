"use client";

import useSWR from "swr";
import type { EntriesResponse, EntryDetailResponse, Entry } from "@/lib/types";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useEntries(params?: Record<string, string>) {
  const searchParams = new URLSearchParams(params || {});
  const key = `/api/tracker/entries?${searchParams.toString()}`;
  return useSWR<EntriesResponse>(key, fetcher);
}

export function useEntry(id: string | null) {
  return useSWR<EntryDetailResponse>(
    id ? `/api/tracker/entries/${id}` : null,
    fetcher,
    {
      // Poll every 5s while ANY background generation is running — the
      // bundled summary pipeline (entry.summaryStatus) or any of the
      // per-artifact generators (entry.analysisJobs[kind].status). The poll
      // stops as soon as nothing is in-flight.
      refreshInterval: (latestData) => {
        const entry = latestData?.entry;
        if (!entry) return 0;
        if (entry.summaryStatus === "running") return 5000;
        const jobs = entry.analysisJobs;
        if (jobs && Object.values(jobs).some((j) => j?.status === "running")) {
          return 5000;
        }
        return 0;
      },
    }
  );
}

export async function createEntry(data: Partial<Entry>) {
  const res = await fetch("/api/tracker/entries", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to create entry");
  return res.json();
}

export async function updateEntry(id: string, data: Partial<Entry>) {
  const res = await fetch(`/api/tracker/entries/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to update entry");
  return res.json();
}

export async function deleteEntry(id: string) {
  const res = await fetch(`/api/tracker/entries/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete entry");
  return res.json();
}
