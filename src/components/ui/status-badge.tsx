"use client";

import { STATUSES } from "@/lib/constants";

export function StatusBadge({ status }: { status: string }) {
  const info = STATUSES.find((s) => s.value === status);
  return (
    <span className={`inline-flex min-h-[30px] items-center gap-2 rounded-full px-2.5 py-1 text-[14px] font-medium st-${status}`}>
      <span className="h-2 w-2 rounded-full border-2 border-current" aria-hidden="true" />
      {info?.label || status}
    </span>
  );
}
