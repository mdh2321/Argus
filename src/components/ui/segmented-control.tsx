"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A segmented toggle whose selection is a single thumb that *slides* between
 * options rather than each segment restyling in place. Toggle physics are felt
 * disproportionately — the slide is what makes a two-state control read as
 * fluid. The thumb tracks the *measured* geometry of the active segment, so
 * segments with unequal content widths (e.g. "Quick" vs "Deep Report") stay
 * covered exactly and never let a neighbour's icon peek through the pill. The
 * transform/width are GPU-composited and disabled under prefers-reduced-motion.
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

  const containerRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    function measure() {
      const container = containerRef.current;
      const btn = btnRefs.current[activeIndex];
      if (!container || !btn) return;
      // offsetLeft is already relative to the positioned container, so it
      // accounts for the container's padding without extra bookkeeping.
      setThumb({ left: btn.offsetLeft, width: btn.offsetWidth });
    }
    measure();

    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    // Re-measure when the control resizes (font load, container reflow).
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    btnRefs.current.forEach((b) => b && ro.observe(b));
    return () => ro.disconnect();
  }, [activeIndex, options.length]);

  return (
    <div
      ref={containerRef}
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "relative inline-flex items-center rounded-xl border border-border bg-surface p-0.5",
        className
      )}
    >
      {/* Sliding thumb — matches the measured geometry of the active segment. */}
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-y-0.5 left-0 rounded-[10px] bg-accent shadow-[var(--shadow-s)]",
          "transition-[transform,width] duration-200 ease-out motion-reduce:transition-none",
          thumb ? "opacity-100" : "opacity-0"
        )}
        style={
          thumb
            ? { width: thumb.width, transform: `translateX(${thumb.left}px)` }
            : undefined
        }
      />
      {options.map((o, i) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              btnRefs.current[i] = el;
            }}
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
