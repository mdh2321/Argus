import { cn } from "@/lib/utils";

/**
 * Loading placeholders that echo the shape of the content they stand in for —
 * a list of skeleton rows reads as "almost here", where a lone centered
 * spinner reads as "stuck". Pulse is disabled under prefers-reduced-motion.
 */

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-hover motion-reduce:animate-none",
        className
      )}
    />
  );
}

/** One placeholder row shaped like an entries-table / list row. */
export function SkeletonRow() {
  return (
    <div className="flex items-start gap-4 py-4 border-b border-border last:border-0">
      <div className="flex flex-col items-center gap-2 w-12 flex-shrink-0">
        <Skeleton className="h-4 w-6 rounded" />
        <Skeleton className="h-3 w-8 rounded" />
      </div>
      <div className="flex-1 min-w-0 space-y-2">
        <Skeleton className="h-3.5 w-2/5" />
        <Skeleton className="h-2.5 w-4/5" />
        <Skeleton className="h-2.5 w-1/3" />
      </div>
      <div className="flex flex-col items-end gap-2 flex-shrink-0">
        <Skeleton className="h-3.5 w-16 rounded-full" />
        <Skeleton className="h-2.5 w-10" />
      </div>
    </div>
  );
}

/** A stack of skeleton rows for list-shaped surfaces. */
export function SkeletonList({ rows = 6 }: { rows?: number }) {
  return (
    <div className="anim-enter" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  );
}

/** One placeholder shaped like a bordered content card (digest story, topic). */
export function SkeletonCard() {
  return (
    <div className="rounded-xl border border-border bg-surface p-6 space-y-3">
      <div className="flex items-center gap-2">
        <Skeleton className="h-4 w-16 rounded-full" />
        <Skeleton className="h-4 w-20 rounded-full" />
      </div>
      <Skeleton className="h-5 w-3/4" />
      <Skeleton className="h-3 w-1/3" />
      <div className="space-y-2 pt-1">
        <Skeleton className="h-2.5 w-full" />
        <Skeleton className="h-2.5 w-5/6" />
      </div>
    </div>
  );
}

/** A stack of skeleton cards for card-shaped surfaces. */
export function SkeletonCards({
  count = 3,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div
      className={cn("space-y-4 anim-enter", className)}
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">Loading…</span>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}
