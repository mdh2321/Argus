import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

// The one page-header treatment for landing / browse surfaces: a section icon,
// a quiet title, generous spacing, and an optional subtitle, with
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
    <div className="mb-10 flex flex-wrap items-center justify-between gap-4">
      <div className="relative py-1">
        <div className="relative z-10 flex items-center gap-2.5">
          <Icon className="h-5 w-5" style={{ color: iconColor }} />
          <h1 className="text-fg text-[32px] sm:text-[40px] font-medium leading-[1.15] tracking-[-0.035em]">{title}</h1>
        </div>
        {subtitle && <div className="relative z-10 mt-3 max-w-2xl text-[15px] text-fg-3">{subtitle}</div>}
      </div>
      {action}
    </div>
  );
}
