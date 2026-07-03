"use client";

import { useDigestStories } from "@/hooks/use-digest";
import { StoryBlock } from "@/components/digest/story-block";
import { Star, Loader2 } from "lucide-react";

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
        <div className="flex justify-center py-20">
          <Loader2 className="h-5 w-5 animate-spin text-fg-3" />
        </div>
      ) : stories.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface px-6 py-16 text-center text-[14px] text-fg-3">
          Nothing saved yet. Star a story in any digest issue and it lands here.
        </div>
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
