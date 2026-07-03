"use client";

import useSWR from "swr";
import type { HorizonResponse } from "@/lib/types";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useHorizon() {
  return useSWR<HorizonResponse>("/api/horizon", fetcher);
}
