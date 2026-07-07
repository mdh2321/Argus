"use client";

import type { Entry } from "@/lib/types";
import { ENTRY_TYPES, STATUSES, JURISDICTIONS } from "@/lib/constants";
import { formatDate, relativeTime } from "@/lib/utils";

// Compact key-value reference card for the right rail. Surfaces the formal
// metadata that's otherwise scattered across the masthead, status badges,
// and change history. Lives below the TOC so the rail does double duty as
// "navigate the page" + "facts at a glance" without sending the lawyer
// hunting through the body for jurisdiction / regulator / dates.
export function QuickFacts({ entry }: { entry: Entry }) {
  const facts: { label: string; value: React.ReactNode }[] = [];

  const typeLabel = ENTRY_TYPES.find((t) => t.value === entry.type)?.label ?? entry.type;
  facts.push({ label: "Type", value: typeLabel });

  const jurisdictionLabel =
    JURISDICTIONS.find((j) => j.code === entry.jurisdiction)?.name ?? entry.jurisdiction;
  facts.push({ label: "Jurisdiction", value: jurisdictionLabel });

  const statusLabel = STATUSES.find((s) => s.value === entry.status)?.label ?? entry.status;
  facts.push({ label: "Status", value: statusLabel });

  if (entry.regulator) {
    facts.push({ label: "Regulator", value: entry.regulator });
  }

  if (entry.nextKeyDate) {
    facts.push({ label: "Next date", value: formatDate(entry.nextKeyDate) });
  }

  facts.push({ label: "Last updated", value: relativeTime(entry.updatedAt) });

  return (
    <div className="mt-6 rounded-xl border border-border bg-surface p-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.04em] text-fg-3 mb-2">
        Quick facts
      </div>
      <dl className="space-y-2">
        {facts.map((f) => (
          <div key={f.label} className="flex flex-col gap-0.5">
            <dt className="font-mono text-[10px] uppercase tracking-[0.04em] text-fg-3">
              {f.label}
            </dt>
            <dd className="text-[12px] text-fg break-words">{f.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
