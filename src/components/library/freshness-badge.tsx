"use client";

import { relativeTime } from "@/lib/utils";

// Wiki-discipline freshness chip: staleness is never hidden. Green = compiled
// after the latest movement in the topic's membership; amber = something
// moved since (or no compile yet).
export function FreshnessBadge({
  stale,
  lastGenerated,
}: {
  stale: boolean;
  lastGenerated: string | null;
}) {
  if (!lastGenerated) {
    return (
      <span className="flex-shrink-0 rounded-full border border-amber/30 bg-amber-bg px-2 py-0.5 font-mono text-[10px] font-medium text-amber">
        not compiled
      </span>
    );
  }
  if (stale) {
    return (
      <span className="flex-shrink-0 rounded-full border border-amber/30 bg-amber-bg px-2 py-0.5 font-mono text-[10px] font-medium text-amber">
        stale · compiled {relativeTime(lastGenerated)}
      </span>
    );
  }
  return (
    <span className="flex-shrink-0 rounded-full border border-green/20 bg-green-bg px-2 py-0.5 font-mono text-[10px] font-medium text-green">
      compiled {relativeTime(lastGenerated)}
    </span>
  );
}
