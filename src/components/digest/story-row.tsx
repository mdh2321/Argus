"use client";

import Link from "next/link";
import { ArrowUpRight, Bookmark, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { useSWRConfig } from "swr";
import { toast } from "sonner";
import { setStorySaved, type DigestStory } from "@/hooks/use-digest";
import { formatDate } from "@/lib/utils";

export function StoryRow({ story, issueSlug, onRead }: { story: DigestStory; issueSlug?: string; onRead?: () => void }) {
  const { mutate } = useSWRConfig();
  const [saving, setSaving] = useState(false);
  async function toggleSave() {
    setSaving(true);
    try {
      await setStorySaved(story.id, !story.saved);
      await mutate(key => typeof key === "string" && (key.startsWith("/api/digest/stories") || key.startsWith("/api/digest/issues")));
    } catch { toast.error("Couldn’t update saved stories"); }
    finally { setSaving(false); }
  }
  const heading = <><h3 className="text-[23px] font-medium leading-[1.3] tracking-[-.025em] transition-colors group-hover:text-accent-text">{story.title}</h3><p className="mt-3 line-clamp-2 text-[15px] leading-[1.75] text-fg-2">{story.summary}</p></>;
  return <article className="grid grid-cols-[112px_minmax(0,1fr)_32px] gap-5 border-b border-border py-7">
    <div className="pt-1 text-[13px] text-fg-3"><p className="text-fg-2">{story.jurisdictionCode || story.jurisdiction || "Regional"}</p><p className="mt-2">{formatDate(story.date)}</p>{story.impact && <p className={`mt-4 text-[12px] ${story.impact === "High" ? "text-accent-text" : "text-fg-3"}`}>{story.impact} impact</p>}</div>
    <div className="min-w-0">{onRead ? <button type="button" onClick={onRead} className="group block w-full text-left">{heading}</button> : <Link href={`/digest/issues/${issueSlug}#${story.id}`} className="group block">{heading}</Link>}<div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-[12px] text-fg-3"><span>{story.source}</span><span>·</span><span>{story.contentType}</span>{story.url && story.url !== "#" && <a href={story.url} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 hover:text-accent-text">Original source<ArrowUpRight size={13} /></a>}</div></div>
    <button type="button" onClick={toggleSave} disabled={saving} aria-label={story.saved ? "Remove from saved" : "Save story"} aria-pressed={story.saved} className={`h-8 rounded-lg p-2 hover:bg-hover ${story.saved ? "text-accent-text" : "text-fg-3"}`}>{saving ? <LoaderCircle size={16} className="animate-spin" /> : <Bookmark size={16} fill={story.saved ? "currentColor" : "none"} />}</button>
  </article>;
}
