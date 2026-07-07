import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The one empty-state treatment: a soft accent icon tile, a short title, a
 * line of guidance, and an optional action slot. Mirrors the Ask hero so an
 * empty tracker / library / digest reads as intentional, not broken.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  size = "md",
}: {
  icon: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  size?: "sm" | "md";
}) {
  const pad = size === "sm" ? "py-10" : "py-16";
  const tile = size === "sm" ? "h-10 w-10 rounded-xl" : "h-12 w-12 rounded-2xl";
  const iconSize = size === "sm" ? "h-5 w-5" : "h-6 w-6";
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center anim-enter",
        pad,
        className
      )}
    >
      <div
        className={cn(
          "mb-4 flex items-center justify-center border border-border-accent bg-accent-bg",
          tile
        )}
      >
        <Icon className={iconSize} style={{ color: "var(--accent)" }} strokeWidth={1.5} />
      </div>
      <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-fg">{title}</h3>
      {description && (
        <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-fg-3">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
