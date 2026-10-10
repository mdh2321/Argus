"use client";

import useSWR from "swr";
import type { DeadlinesResponse } from "@/lib/types";

const fetcher = (url: string) => fetch(url).then((r) => { if (!r.ok) throw new Error("Unable to load dates"); return r.json(); });

export function useDeadlines() {
  return useSWR<DeadlinesResponse>("/api/tracker/deadlines", fetcher);
}
