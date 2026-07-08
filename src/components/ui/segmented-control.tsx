"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A segmented toggle whose selection is a single thumb that *slides* between
 * options rather than each segment restyling in place. Toggle physics are felt
 * disproportionately — the slide is what makes a two-state control read as
 * fluid. Segments are equal-width so the thumb can move by whole multiples of
 * its own width; the transform is GPU-composited and disabled under
 * prefers-reduced-motion.
 */

interface Segment<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className,
  "aria-label": ariaLabel,
}: {
  options: Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  "aria-label"?: string;
}) {
  const activeIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value)
  );
  const n = options.length;

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "relative inline-flex items-center rounded-xl border border-border bg-surface p-0.5",
        className
      )}
    >
      {/* Sliding thumb — width of one segment, translated by whole segments. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0.5 left-0.5 rounded-[10px] bg-accent shadow-[var(--shadow-s)] transition-transform duration-200 ease-out motion-reduce:transition-none"
        style={{
          width: `calc((100% - 4px) / ${n})`,
          transform: `translateX(${activeIndex * 100}%)`,
        }}
      />
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "relative z-10 flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] px-3 py-1.5",
              "font-mono text-[11px] font-medium uppercase tracking-[0.04em] transition-colors duration-150",
              active ? "text-white" : "text-fg-3 hover:text-fg-2"
            )}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
