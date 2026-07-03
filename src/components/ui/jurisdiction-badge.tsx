"use client";

import { JURISDICTIONS } from "@/lib/constants";

export function JurisdictionBadge({
  code,
  showName = false,
}: {
  code: string;
  showName?: boolean;
}) {
  const j = JURISDICTIONS.find((j) => j.code === code);
  if (!j) return <span className="font-mono text-[11px] text-fg-3">{code}</span>;

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-[14px] leading-none">{j.flag}</span>
      <span className="font-mono text-[11px] tracking-[0.02em] font-medium text-fg-2">
        {showName ? j.name : j.code}
      </span>
    </span>
  );
}
