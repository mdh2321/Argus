"use client";

import useSWR from "swr";
import type { Signal } from "@/lib/types";

const fetcher = (url: string) => fetch(url).then((r) => { if (!r.ok) throw new Error("Unable to load signals"); return r.json(); });

export function useSignals(params?: { status?: string }) {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set("status", params.status);
  const key = `/api/signals?${searchParams.toString()}`;
  return useSWR<{ signals: Signal[]; total: number }>(key, fetcher);
}

export async function triggerGenerateSignals(): Promise<{ signals: Signal[]; generated: number }> {
  const res = await fetch("/api/signals/generate", { method: "POST" });
  if (!res.ok) throw new Error("Failed to generate signals");
  return res.json();
}
