"use client";

import Link from "next/link";
import { use } from "react";
import { useDigestTags, useDigestStories, type DigestTagInfo } from "@/hooks/use-digest";
import { StoryBlock } from "@/components/digest/story-block";
import { SkeletonCards } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/button";
import { Tag } from "lucide-react";

// Resolve a tag to the exact story filter it represents. Tags come in three
// kinds (jurisdiction / legal-area / content-type), each stored on a different
// column, so a single fuzzy text search would both miss and over-match. When
// the tag isn't found in the aggregate (legacy links), fall back to search.
function filterFor(
  tag: DigestTagInfo | undefined,
  rawName: string
): Parameters<typeof useDigestStories>[0] {
  if (!tag) return { search: rawName, limit: 50 };
  switch (tag.type) {
    case "jurisdiction":
      return { jurisdictionName: tag.name, limit: 50 };
    case "legal-area":
      return { category: tag.name, limit: 50 };
    case "content-type":
      return { contentType: tag.name.toLowerCase().replace(/ /g, "-"), limit: 50 };
  }
}

export default function DigestTagPage({ params }: { params: Promise<{ tag: string }> }) {
  const { tag: tagSlug } = use(params);
  const tagName = decodeURIComponent(tagSlug);

  const { data: tagsData } = useDigestTags();
  const allTags = tagsData?.tags || [];
  const matchedTag = allTags.find(
    (t) => t.slug === tagSlug || t.name.toLowerCase() === tagName.toLowerCase()
  );

  const { data: storiesData, isLoading } = useDigestStories(filterFor(matchedTag, tagName));
  const stories = storiesData?.stories || [];
  const displayName = matchedTag?.name || tagName;

  return (
    <div className="anim-enter mx-auto max-w-3xl">
      <nav className="label-mono mb-6 flex items-center gap-2">
        <Link href="/digest" className="transition-colors hover:text-accent">Digest</Link>
        <span>&gt;</span>
        <Link href="/digest/tags" className="transition-colors hover:text-accent">Tags</Link>
        <span>&gt;</span>
        <span className="text-fg-2">{displayName}</span>
      </nav>

      <div className="mb-1 flex items-center gap-2">
        <Tag className="h-4 w-4 text-accent" />
        <h1 className="text-2xl font-bold text-fg">{displayName}</h1>
      </div>
      <p className="mb-8 font-mono text-[13px] text-fg-3">
        {isLoading ? "Loading…" : `${stories.length} stor${stories.length !== 1 ? "ies" : "y"}`}
      </p>

      {isLoading ? (
        <SkeletonCards count={4} />
      ) : stories.length === 0 ? (
        <EmptyState
          icon={Tag}
          title={`No stories tagged “${displayName}”`}
          description="Try another tag, or browse the full list."
          action={
            <ButtonLink href="/digest/tags" variant="secondary" size="sm">
              Browse all tags
            </ButtonLink>
          }
        />
      ) : (
        <div className="space-y-4 stagger">
          {stories.map((story) => (
            <StoryBlock key={story.id} story={story} />
          ))}
        </div>
      )}
    </div>
  );
}
