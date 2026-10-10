"use client";

import { IMPACT_LABELS } from "@/lib/constants";

const COLORS: Record<number, string> = {
  1: "var(--fg-3)",
  2: "var(--cyan)",
  3: "var(--amber)",
  4: "var(--accent)",
  5: "var(--red)",
};

export function ImpactIndicator({
  score,
  showLabel = false,
}: {
  score: number | null;
  showLabel?: boolean;
}) {
  if (!score) {
    return (
      <span className="text-[14px] text-fg-3" aria-label="Impact not assessed">
        Not rated
      </span>
    );
  }

  const color = COLORS[score] || "var(--fg-3)";

  return (
    <div className="flex items-center gap-2" role="img" aria-label={`Impact: ${IMPACT_LABELS[score]} (${score} of 5)`}>
      <div className="flex gap-[3px] items-end" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="w-[3px] rounded-full transition-all duration-200"
            style={{
              height: `${6 + i * 2}px`,
              backgroundColor: i <= score ? color : "var(--border-hover)",
            }}
          />
        ))}
      </div>
      {showLabel && (
        <span className="text-[14px] font-medium" style={{ color }} aria-hidden="true">
          {IMPACT_LABELS[score]}
        </span>
      )}
    </div>
  );
}
