"use client";

import { ShieldCheck, ShieldAlert, ShieldQuestion, ShieldOff } from "lucide-react";
import type { KnowledgeConfidence } from "@/lib/types";

const config: Record<
  KnowledgeConfidence,
  { label: string; color: string; bg: string; Icon: typeof ShieldCheck }
> = {
  high: { label: "High confidence", color: "var(--green)", bg: "var(--green-bg)", Icon: ShieldCheck },
  medium: { label: "Medium confidence", color: "var(--amber)", bg: "var(--amber-bg)", Icon: ShieldAlert },
  low: { label: "Low confidence", color: "var(--red)", bg: "var(--red-bg)", Icon: ShieldQuestion },
  unverified: { label: "Unverified", color: "var(--fg-3)", bg: "var(--bg-hover)", Icon: ShieldOff },
};

export function ConfidenceBadge({
  confidence,
  showLabel = true,
  size = "sm",
}: {
  confidence: KnowledgeConfidence;
  showLabel?: boolean;
  size?: "sm" | "md";
}) {
  const { label, color, bg, Icon } = config[confidence] || config.unverified;
  const iconSize = size === "sm" ? "w-3 h-3" : "w-3.5 h-3.5";
  const textSize = size === "sm" ? "text-[10px]" : "text-[11px]";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-[2px] font-mono ${textSize} tracking-[0.04em] uppercase font-medium`}
      style={{ color, backgroundColor: bg }}
    >
      <Icon className={iconSize} strokeWidth={1.5} />
      {showLabel && label}
    </span>
  );
}

export function GroundingBar({ ratio, size = "sm" }: { ratio: number; size?: "sm" | "md" }) {
  const pct = Math.round(ratio * 100);
  const color = ratio >= 0.8 ? "var(--green)" : ratio >= 0.5 ? "var(--amber)" : "var(--red)";
  const height = size === "sm" ? "h-1" : "h-1.5";

  return (
    <div className="flex items-center gap-2">
      <div className={`flex-1 ${height} rounded-full overflow-hidden`} style={{ backgroundColor: "var(--bg-hover)" }}>
        <div
          className={`${height} rounded-full transition-all duration-500`}
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="font-mono text-[10px] text-fg-3 tabular-nums">{pct}%</span>
    </div>
  );
}
