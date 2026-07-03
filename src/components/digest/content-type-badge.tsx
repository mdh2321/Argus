import { getContentTypeInfo } from "@/lib/digest-utils";

export function ContentTypeBadge({ type }: { type: string }) {
  const info = getContentTypeInfo(type);
  return (
    <span
      className="inline-block px-2 py-0.5 rounded-full font-mono text-[10px] uppercase tracking-[0.04em] font-medium"
      style={{ color: info.color, background: info.bg }}
    >
      {info.label}
    </span>
  );
}
