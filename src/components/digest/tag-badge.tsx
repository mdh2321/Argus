import Link from "next/link";

interface TagBadgeProps {
  name: string;
  size?: "sm" | "md";
  linked?: boolean;
}

export function TagBadge({ name, size = "md", linked = false }: TagBadgeProps) {
  const slug = encodeURIComponent(name.toLowerCase());
  const sizeClasses = size === "sm"
    ? "px-2 py-0.5 text-[10px]"
    : "px-2.5 py-1 text-[11px]";

  const className = `inline-block rounded-full bg-hover font-mono ${sizeClasses} text-fg-2 transition-colors hover:bg-active hover:text-accent`;

  if (linked) {
    return (
      <Link href={`/digest/tags/${slug}`} className={className}>
        {name}
      </Link>
    );
  }

  return <span className={className}>{name}</span>;
}
