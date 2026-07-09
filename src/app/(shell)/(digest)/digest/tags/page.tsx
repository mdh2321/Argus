"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useDigestTags, type DigestTagInfo } from "@/hooks/use-digest";
import { JURISDICTIONS } from "@/lib/constants";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/layout/page-header";
import { Tag, Globe, Scale, FileType } from "lucide-react";

// Browsable tag index — the way in to "show me every story about AI". Tags are
// derived from each story's jurisdiction, legal areas, and format, so we group
// by those three kinds rather than dumping one flat cloud. Each chip drills
// into an exact-filtered list at /digest/tags/[slug].

const GROUPS: {
  type: DigestTagInfo["type"];
  label: string;
  icon: typeof Globe;
  hint: string;
}[] = [
  { type: "legal-area", label: "Legal areas", icon: Scale, hint: "AI, privacy, payments, and other themes" },
  { type: "jurisdiction", label: "Jurisdictions", icon: Globe, hint: "Coverage by country or region" },
  { type: "content-type", label: "Formats", icon: FileType, hint: "Non-regulatory item types" },
];

export default function DigestTagsPage() {
  const { data, isLoading } = useDigestTags();
  const allTags = useMemo(() => data?.tags ?? [], [data]);

  return (
    <div className="anim-enter mx-auto max-w-3xl">
      <PageHeader
        icon={Tag}
        iconColor="var(--purple)"
        title="Tags"
        subtitle="Browse stories by legal area, jurisdiction, or format."
      />

      {isLoading ? (
        <div className="space-y-8">
          {GROUPS.map((g) => (
            <div key={g.type}>
              <Skeleton className="mb-3 h-3 w-32" />
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-24 rounded-full" />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : allTags.length === 0 ? (
        <EmptyState
          icon={Tag}
          title="No tags yet"
          description="Once digest stories are published, their jurisdictions and legal areas become browsable tags here."
        />
      ) : (
        <div className="space-y-9">
          {GROUPS.map((group) => {
            const tags = allTags.filter((t) => t.type === group.type);
            if (tags.length === 0) return null;
            const Icon = group.icon;
            return (
              <section key={group.type}>
                <div className="mb-3 flex items-baseline gap-2.5">
                  <span className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.06em] text-fg-2">
                    <Icon className="h-3.5 w-3.5 text-fg-3" />
                    {group.label}
                  </span>
                  <span className="text-[12px] text-fg-3">{group.hint}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {tags.map((tag) => (
                    <TagChip key={`${group.type}-${tag.slug}`} tag={tag} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TagChip({ tag }: { tag: DigestTagInfo }) {
  const flag =
    tag.type === "jurisdiction"
      ? JURISDICTIONS.find((j) => j.name === tag.name)?.flag ?? ""
      : "";
  return (
    <Link
      href={`/digest/tags/${tag.slug}`}
      className="group inline-flex items-center gap-2 rounded-full border border-border bg-surface py-1.5 pl-3 pr-2 transition-colors hover:border-border-hover hover:bg-hover"
    >
      {flag && <span className="text-[13px] leading-none">{flag}</span>}
      <span className="text-[13px] font-medium text-fg-2 group-hover:text-fg">{tag.name}</span>
      <span className="tnum rounded-full bg-hover px-1.5 py-0.5 font-mono text-[10px] text-fg-3 group-hover:bg-active">
        {tag.count}
      </span>
    </Link>
  );
}
