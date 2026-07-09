import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

// The one page-header treatment for landing / browse surfaces: a section icon,
// a gradient title, and an optional subtitle over the faint grid pattern, with
// an optional action on the right. Keeping every top-level page on this one
// component is what makes moving between them feel like one product.
export function PageHeader({
  icon: Icon,
  iconColor = "var(--accent)",
  title,
  subtitle,
  action,
}: {
  icon: LucideIcon;
  iconColor?: string;
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div className="relative grid-pattern py-4">
        <div className="relative z-10 flex items-center gap-2.5">
          <Icon className="h-5 w-5" style={{ color: iconColor }} />
          <h1 className="text-gradient text-[28px] font-bold tracking-[-0.02em]">{title}</h1>
        </div>
        {subtitle && <div className="relative z-10 mt-1.5 text-[14px] text-fg-3">{subtitle}</div>}
      </div>
      {action}
    </div>
  );
}
