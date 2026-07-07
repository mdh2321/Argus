"use client";

import { useDigestStories } from "@/hooks/use-digest";
import { StoryBlock } from "@/components/digest/story-block";
import { Star } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonCards } from "@/components/ui/skeleton";

// Personal shortlist of "things to raise with the business". Deliberately
// not a workflow — no statuses, no owners, just starred stories newest first.
export default function SavedStoriesPage() {
  const { data, isLoading } = useDigestStories({ saved: true, limit: 100 });
  const stories = data?.stories || [];

  return (
    <div className="anim-enter">
      <div className="relative mb-8 grid-pattern py-4">
        <div className="relative z-10 flex items-center gap-2.5">
          <Star className="h-5 w-5" style={{ color: "var(--amber)" }} />
          <h1 className="text-gradient text-[28px] font-bold tracking-[-0.02em]">Saved</h1>
        </div>
        <p className="relative z-10 mt-1.5 max-w-xl text-[14px] text-fg-3">
          Your starred stories — things to raise with the business.
        </p>
      </div>

      {isLoading ? (
        <SkeletonCards count={3} />
      ) : stories.length === 0 ? (
        <EmptyState
          icon={Star}
          title="Nothing saved yet"
          description="Star a story in any digest issue and it lands here for quick reference."
        />
      ) : (
        <div className="space-y-4">
          {stories.map((story) => (
            <StoryBlock key={story.id} story={story} />
          ))}
        </div>
      )}
    </div>
  );
}
