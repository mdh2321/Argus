"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Bookmark, FileText, MessageCircle, Search, Plus, ArrowUpRight } from "lucide-react";
import { GenerateBriefingDialog } from "@/components/library/generate-briefing-dialog";
import { useDigestStories, type DigestStory } from "@/hooks/use-digest";
import { StoryRow } from "@/components/digest/story-row";
import { StoryBlock } from "@/components/digest/story-block";
import { SidePanel } from "@/components/shared/side-panel";
import { SubNav } from "@/components/layout/sub-nav";
import { formatDate } from "@/lib/utils";
import type { KnowledgeItem } from "@/lib/types";

const fetcher = (url: string) => fetch(url).then(r => { if (!r.ok) throw new Error("Unable to load saved work"); return r.json(); });
const filters = ["Everything", "Briefings", "Answers", "Stories"] as const;
type Filter = typeof filters[number];

export default function ThreadsPage() {
  const { data, isLoading, error, mutate } = useSWR<{ items: KnowledgeItem[] }>("/api/library/shelf", fetcher);
  const { data: storyData, isLoading: storiesLoading, error: storiesError, mutate: mutateStories } = useDigestStories({ saved: true, limit: 500 });
  const [filter, setFilter] = useState<Filter>("Everything");
  const [query, setQuery] = useState("");
  const [generate, setGenerate] = useState(false);
  const [story, setStory] = useState<DigestStory | null>(null);
  const items = useMemo(() => (data?.items ?? []).filter(item => (filter === "Everything" || (filter === "Briefings" && item.itemType === "briefing") || (filter === "Answers" && item.itemType === "pinned_answer")) && item.title.toLowerCase().includes(query.toLowerCase())), [data, filter, query]);
  const stories = (filter === "Everything" || filter === "Stories") ? (storyData?.stories ?? []).filter(s => `${s.title} ${s.summary}`.toLowerCase().includes(query.toLowerCase())) : [];
  return <div className="anim-enter">
    <SubNav links={[{ href: "/saved", label: "Threads", exact: true }, { href: "/library", label: "Topics", exact: true }, { href: "/library/threads", label: "Conversations" }]} />
    <header className="mb-9 flex items-start justify-between gap-6"><div><p className="page-kicker mb-3">Your saved work</p><h1 className="page-title">Threads</h1><p className="mt-3 text-[16px] text-fg-3">Briefings, answers and stories. Ready when you need them.</p></div><button onClick={() => setGenerate(true)} className="argus-primary"><Plus size={16} />New briefing</button></header>
    <div className="mb-8 flex flex-wrap items-center justify-between gap-4"><div className="flex gap-1">{filters.map(f => <button key={f} aria-pressed={f === filter} onClick={() => setFilter(f)} className={`rounded-lg px-4 py-2 text-[14px] ${f === filter ? "bg-hover text-fg" : "text-fg-3 hover:text-fg"}`}>{f}</button>)}</div><label className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2"><Search size={16} className="text-fg-3" /><input aria-label="Search saved items" placeholder="Find something saved" value={query} onChange={e => setQuery(e.target.value)} className="w-48 bg-transparent text-[14px] outline-none" /></label></div>
    {(error || storiesError) && <p role="alert" className="mb-6 text-red-text">Some saved items couldn’t be loaded. Try refreshing.</p>}
    {(isLoading || storiesLoading) ? <p role="status" className="py-16 text-fg-3">Opening your saved work…</p> : <>
      {!items.length && !stories.length && <div className="quiet-card py-16 text-center"><Bookmark className="mx-auto mb-4 text-accent-text" /><h2 className="text-[22px]">{query ? "Nothing matches that search." : "A place for your best finds."}</h2><p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-fg-3">{query ? "Try a different phrase or category." : "Save a story from Digest, keep an answer from Ask Argus, or create a briefing."}</p><Link className="argus-secondary mt-6" href="/digest">Explore the digest<ArrowUpRight size={15} /></Link></div>}
      <div className="grid grid-cols-2 gap-5">{items.map(item => { const Icon = item.itemType === "pinned_answer" ? MessageCircle : FileText; const label = item.itemType === "briefing" ? "Briefing" : item.itemType === "pinned_answer" ? "Saved answer" : "Archived comparison"; return <Link key={item.id} href={`/library/briefings/${item.id}`} className="quiet-card group flex min-h-48 flex-col p-6 transition-colors hover:border-border-hover hover:bg-hover"><div className="mb-6 flex items-center justify-between text-fg-3"><Icon size={21} strokeWidth={1.5} /><ArrowUpRight size={16} /></div><p className="page-kicker mb-2">{label}</p><h2 className="text-[21px] font-medium leading-snug tracking-[-.025em] group-hover:text-accent-text">{item.title}</h2><p className="mt-auto pt-5 text-[13px] text-fg-3">Saved snapshot · {formatDate(item.lastGenerated || item.createdAt)}</p></Link>; })}</div>
      {stories.length > 0 && <section className={items.length ? "mt-10" : ""}>{items.length > 0 && <h2 className="mb-2 text-[19px] font-medium">Saved stories</h2>}{stories.map(s => <StoryRow key={s.id} story={s} onRead={() => setStory(s)} />)}</section>}
      {storyData && storyData.total > storyData.stories.length && <p className="mt-5 text-[13px] text-fg-3">Showing the {storyData.stories.length} most recent saved stories.</p>}
    </>}
    <GenerateBriefingDialog open={generate} onOpenChange={setGenerate} onGenerated={() => mutate()} />
    <SidePanel open={!!story} onClose={() => {setStory(null);void mutateStories();}} title="Saved story" description="Read, revisit the source, or ask a follow-up.">{story && <StoryBlock key={story.id} story={story} />}</SidePanel>
  </div>;
}
