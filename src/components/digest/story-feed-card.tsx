"use client";

import Link from "next/link";
import type { DigestStory } from "@/hooks/use-digest";
import { getFlag } from "@/lib/digest-utils";
import { SourceFavicon } from "@/components/ui/source-favicon";
import { ImpactGlyph } from "./impact-glyph";
import { AlertTriangle } from "lucide-react";

// A compact, scannable story card for the Discover-style digest feed. Reading
// and asking happen on the issue page (the full StoryBlock with its composer),
// so this card only has to invite the click — same de-cluttered language as the
// card: flush headline, fills not borders, minimal meta, impact as a glyph.
export function StoryFeedCard({
  story,
  issueSlug,
  hero = false,
}: {
  story: DigestStory;
  issueSlug: string;
  hero?: boolean;
}) {
  const hasLink = !!story.url && story.url !== "#";
  // The issues-list endpoint doesn't hydrate references, so default to none.
  const trackedCount = (story.references ?? []).filter((r) => r.status === "matched").length;
  const dateLabel = new Date(story.date).toLocaleDateString("en-US", { month: "short", day: "numeric" });

  return (
    <Link
      href={`/digest/issues/${issueSlug}#${story.id}`}
      className="group flex flex-col rounded-xl bg-surface p-5 shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-card-hover)]"
    >
      <h3
        className={`font-semibold leading-snug tracking-[-0.01em] text-fg transition-colors group-hover:text-accent ${
          hero ? "text-[22px]" : "text-[16px]"
        }`}
      >
        {story.title}
      </h3>

      <div className="mt-2 flex items-center gap-2 font-mono text-[11px] text-fg-3">
        {hasLink && <SourceFavicon url={story.url} size={14} />}
        <span className="leading-none">{getFlag(story.jurisdictionCode || "")}</span>
        <span className="truncate">{story.source}</span>
        <span className="opacity-50">&middot;</span>
        <span className="tnum flex-shrink-0">{dateLabel}</span>
        <span className="ml-auto flex flex-shrink-0 items-center gap-2.5">
          {trackedCount > 0 && (
            <span className="text-accent-text" title={`${trackedCount} linked to tracker`}>
              {trackedCount} tracked
            </span>
          )}
          {story.urgency === "immediate_action" && (
            <span title="Action required" aria-label="Action required" className="inline-flex">
              <AlertTriangle className="h-3.5 w-3.5 text-red-text" />
            </span>
          )}
          <ImpactGlyph impact={story.impact} />
        </span>
      </div>

      {story.summary && (
        <p
          className={`mt-2.5 text-[13px] leading-relaxed text-fg-2 ${
            hero ? "line-clamp-3" : "line-clamp-2"
          }`}
        >
          {story.summary}
        </p>
      )}
    </Link>
  );
}
