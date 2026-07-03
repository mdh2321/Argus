"use client";

import { Command } from "cmdk";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useDigestIssues, useDigestTags, useDigestStories } from "@/hooks/use-digest";

interface SearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DigestSearchDialog({ open, onOpenChange }: SearchDialogProps) {
  const router = useRouter();
  const { data: issuesData } = useDigestIssues();
  const { data: tagsData } = useDigestTags();
  const { data: storiesData } = useDigestStories({ limit: 10 });

  const issues = issuesData?.issues || [];
  const tags = tagsData?.tags || [];
  const stories = storiesData?.stories || [];

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100]">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={() => onOpenChange(false)} />
      <div className="fixed left-1/2 top-[20%] w-full max-w-lg -translate-x-1/2">
        <Command className="overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-l)]" label="Search digest">
          <Command.Input
            placeholder="Search issues, stories, tags..."
            className="w-full border-b border-border bg-transparent px-4 py-3 text-[15px] text-fg outline-none placeholder:text-fg-3"
            autoFocus
          />
          <Command.List className="max-h-80 overflow-y-auto p-2">
            <Command.Empty className="px-4 py-8 text-center text-[13px] text-fg-3">
              No results found.
            </Command.Empty>

            <Command.Group
              heading="Issues"
              className="[&_[cmdk-group-heading]]:label-mono [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
            >
              {issues.map((issue) => (
                <Command.Item
                  key={issue.slug}
                  value={issue.title}
                  onSelect={() => { router.push(`/digest/issues/${issue.slug}`); onOpenChange(false); }}
                  className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-[14px] text-fg-2 data-[selected=true]:bg-hover data-[selected=true]:text-fg"
                >
                  <span className="font-mono text-[11px] text-fg-3">{issue.date}</span>
                  <span className="truncate">{issue.title}</span>
                </Command.Item>
              ))}
            </Command.Group>

            <Command.Group
              heading="Tags"
              className="[&_[cmdk-group-heading]]:label-mono [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
            >
              {tags.slice(0, 10).map((tag) => (
                <Command.Item
                  key={tag.slug}
                  value={tag.name}
                  onSelect={() => { router.push(`/digest/tags/${tag.slug}`); onOpenChange(false); }}
                  className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-[14px] text-fg-2 data-[selected=true]:bg-hover data-[selected=true]:text-fg"
                >
                  <span className="rounded-full bg-accent-bg px-2 py-0.5 font-mono text-[10px] text-accent">{tag.count}</span>
                  <span>{tag.name}</span>
                </Command.Item>
              ))}
            </Command.Group>

            <Command.Group
              heading="Stories"
              className="[&_[cmdk-group-heading]]:label-mono [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
            >
              {stories.map((story) => (
                <Command.Item
                  key={story.id}
                  value={`${story.title} ${story.jurisdiction || ""} ${story.categories.join(" ")}`}
                  onSelect={() => { router.push(`/digest`); onOpenChange(false); }}
                  className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-[14px] text-fg-2 data-[selected=true]:bg-hover data-[selected=true]:text-fg"
                >
                  <span className="text-base leading-none">{story.jurisdictionCode || ""}</span>
                  <span className="truncate">{story.title}</span>
                </Command.Item>
              ))}
            </Command.Group>
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
