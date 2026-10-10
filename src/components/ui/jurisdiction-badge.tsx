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
  if (!j) return <span className="text-[14px] text-fg-3">Jurisdiction: {code}</span>;

  return (
    <span className="inline-flex items-center gap-1.5" aria-label={`Jurisdiction: ${j.name}`}>
      <span className="text-[16px] leading-none" aria-hidden="true">{j.flag}</span>
      <span className="text-[14px] font-medium text-fg-2" aria-hidden="true">
        {showName ? j.name : j.code}
      </span>
    </span>
  );
}
