"use client";

import useSWR from "swr";
import type { SourceDocument } from "@/lib/types";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useDocuments(entryId: string | null) {
  return useSWR<{ documents: SourceDocument[] }>(
    entryId ? `/api/tracker/entries/${entryId}/documents` : null,
    fetcher
  );
}

export async function addDocument(
  entryId: string,
  data: { name: string; sourceUrl?: string; fullText?: string; fileType?: string; addedBy?: string }
) {
  const res = await fetch(`/api/tracker/entries/${entryId}/documents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to add document");
  return res.json();
}

export async function deleteDocument(entryId: string, docId: string) {
  const res = await fetch(`/api/tracker/entries/${entryId}/documents?docId=${docId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete document");
  return res.json();
}

export async function refetchDocument(entryId: string, docId: string) {
  const res = await fetch(
    `/api/tracker/entries/${entryId}/documents/${docId}/refetch`,
    { method: "POST" }
  );
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}
