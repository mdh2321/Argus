"use client";

import useSWR from "swr";
import type { UserProfile } from "@/lib/types";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useProfile() {
  return useSWR<{ profile: UserProfile }>("/api/profile", fetcher);
}

export async function saveProfile(data: Partial<UserProfile>): Promise<UserProfile> {
  const res = await fetch("/api/profile", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to save profile");
  const json = await res.json();
  return json.profile;
}
