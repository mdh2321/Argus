"use client";

import useSWR from "swr";
import type { DeadlinesResponse } from "@/lib/types";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useDeadlines() {
  return useSWR<DeadlinesResponse>("/api/tracker/deadlines", fetcher);
}
