"use client";

import { STATUSES } from "@/lib/constants";

export function StatusBadge({ status }: { status: string }) {
  const info = STATUSES.find((s) => s.value === status);
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] font-mono text-[10px] tracking-[0.04em] uppercase font-medium st-${status}`}>
      <span className="w-[5px] h-[5px] rounded-full bg-current opacity-60" />
      {info?.label || status}
    </span>
  );
}
