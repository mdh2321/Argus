"use client";

import Link from "next/link";
import { use } from "react";
import { useDigestTags, useDigestStories } from "@/hooks/use-digest";
import { StoryBlock } from "@/components/digest/story-block";
import { Loader2 } from "lucide-react";

export default function DigestTagPage({ params }: { params: Promise<{ tag: string }> }) {
  const { tag: tagSlug } = use(params);
  const tagName = decodeURIComponent(tagSlug);

  const { data: tagsData } = useDigestTags();
  const allTags = tagsData?.tags || [];
  const matchedTag = allTags.find(
    (t) => t.slug === tagSlug || t.name.toLowerCase() === tagName.toLowerCase()
  );

  // Search stories matching this tag by jurisdiction or category
  const { data: storiesData, isLoading } = useDigestStories({
    search: matchedTag?.name,
    limit: 50,
  });
  const stories = storiesData?.stories || [];

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-fg-3" />
      </div>
    );
  }

  return (
    <div className="anim-enter mx-auto max-w-3xl">
      <nav className="label-mono mb-6 flex items-center gap-2">
        <Link href="/digest" className="transition-colors hover:text-accent">Digest</Link>
        <span>&gt;</span>
        <Link href="/digest/tags" className="transition-colors hover:text-accent">Tags</Link>
        <span>&gt;</span>
        <span className="text-fg-2">{matchedTag?.name || tagName}</span>
      </nav>

      <h1 className="mb-2 text-2xl font-bold text-fg">{matchedTag?.name || tagName}</h1>
      <p className="mb-10 font-mono text-[13px] text-fg-3">
        {stories.length} stor{stories.length !== 1 ? "ies" : "y"} found
      </p>

      <div className="space-y-4 stagger">
        {stories.map((story) => (
          <StoryBlock key={story.id} story={story} />
        ))}
        {stories.length === 0 && (
          <p className="py-12 text-center text-[13px] text-fg-3">
            No stories found for this tag.
          </p>
        )}
      </div>
    </div>
  );
}
