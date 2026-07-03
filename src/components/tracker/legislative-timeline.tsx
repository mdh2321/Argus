"use client";

import { Check } from "lucide-react";
import type { KeyDate } from "@/lib/types";
import { formatDate } from "@/lib/utils";

// Vertical legislative-journey timeline. Replaces the flat Key Dates list
// with a checkpoint-style view that shows which milestones are past
// (green check), which is the next upcoming one (filled accent dot), and
// which are future (hollow gray dot). For a tracker product, this is the
// visual that tells a lawyer "where in the legislative pipeline is this
// instrument" at a glance — much richer than a simple list of dates.
//
// Doesn't model legislative-system specifics (different jurisdictions have
// different stages — assent vs royal assent vs presidential signature, etc.)
// — instead it just renders whatever keyDates the analyst/AI captured, in
// chronological order, with past/upcoming/future styling driven by the
// date relative to today.
export function LegislativeTimeline({ keyDates }: { keyDates: KeyDate[] }) {
  // Order chronologically. The "current" / next-upcoming entry is the
  // first item whose date is >= today.
  const sorted = [...keyDates].sort((a, b) => a.date.localeCompare(b.date));
  const today = new Date().toISOString().slice(0, 10);
  const nextUpcomingIdx = sorted.findIndex((kd) => kd.date >= today);

  return (
    <ol className="relative space-y-3">
      {sorted.map((kd, i) => {
        const isPast = kd.date < today;
        const isCurrent = i === nextUpcomingIdx;
        const isLast = i === sorted.length - 1;

        return (
          <li key={`${kd.date}-${i}`} className="relative flex gap-3 pb-1">
            {/* Connector rail. Drawn between the dot and the next item's
                dot. Skipped on the last item so the line doesn't dangle. */}
            {!isLast && (
              <span
                className={`absolute left-[7px] top-[18px] bottom-[-12px] w-px ${
                  isPast ? "bg-[var(--green)]/30" : "bg-border"
                }`}
                aria-hidden
              />
            )}

            {/* Status dot */}
            <span
              className={`flex-shrink-0 mt-[2px] flex items-center justify-center w-[15px] h-[15px] rounded-full border-2 ${
                isPast
                  ? "bg-[var(--green)] border-[var(--green)]"
                  : isCurrent
                    ? "bg-accent border-accent"
                    : "bg-bg border-border"
              }`}
              aria-hidden
            >
              {isPast && <Check className="w-2 h-2 text-white" strokeWidth={3} />}
            </span>

            <div className="flex-1 min-w-0 flex items-baseline justify-between gap-3">
              <span
                className={`text-[13px] ${
                  isCurrent ? "font-medium text-fg" : isPast ? "text-fg-2" : "text-fg-3"
                }`}
              >
                {kd.label}
                {isCurrent && (
                  <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.04em] text-accent">
                    next
                  </span>
                )}
              </span>
              <span className="text-[12px] tabular-nums text-fg-3 flex-shrink-0">
                {formatDate(kd.date)}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
