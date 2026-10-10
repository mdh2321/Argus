"use client";

import Link from "next/link";
import { use, useState } from "react";
import { useTopic, regenerateTopic } from "@/hooks/use-topics";
import { FreshnessBadge } from "@/components/library/freshness-badge";
import { TopicMarkdown } from "@/components/library/topic-markdown";
import { CopyMarkdownButton } from "@/components/shared/copy-markdown-button";
import { StatusBadge } from "@/components/ui/status-badge";
import { ImpactIndicator } from "@/components/ui/impact-indicator";
import { getFlag } from "@/lib/digest-utils";
import { formatDate } from "@/lib/utils";
import { toast } from "sonner";
import { Loader2, RefreshCw, Database, Newspaper, Radar, ChevronRight } from "lucide-react";

// One topic page = a compiled dossier: synthesized explainer (stored,
// regenerated on demand) + tracked laws, recent stories, and active signals
// (all live). The page is never hand-edited.
export default function TopicPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const { data, isLoading, mutate } = useTopic(slug);
  const [regenerating, setRegenerating] = useState(false);

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-fg-3" />
      </div>
    );
  }

  if (!data?.topic) {
    return <div className="py-20 text-center text-fg-3">Topic not found.</div>;
  }

  const { topic, entries, stories, signals } = data;

  async function regenerate() {
    setRegenerating(true);
    try {
      await regenerateTopic(slug);
      await mutate();
      toast.success("Topic page recompiled");
    } catch {
      toast.error("Recompile failed");
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <div className="anim-enter mx-auto max-w-3xl">
      <nav className="label-mono mb-6 flex items-center gap-2">
        <Link href="/library" className="transition-colors hover:text-accent">Topics</Link>
        <span>&gt;</span>
        <span className="text-fg-2">{topic.title}</span>
      </nav>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-bold tracking-[-0.02em] text-fg">{topic.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <FreshnessBadge stale={topic.stale} lastGenerated={topic.lastGenerated} />
            {topic.stale && topic.staleReason && (
              <span className="text-[12px] text-fg-3">{topic.staleReason}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {topic.content && (
            <CopyMarkdownButton
              getMarkdown={() => `**${topic.title} — state of play**\n\n${topic.content}`}
            />
          )}
          <button
            onClick={regenerate}
            disabled={regenerating}
            className="flex items-center gap-1.5 rounded-lg bg-accent/10 px-3 py-1.5 font-mono text-[11px] font-medium text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${regenerating ? "animate-spin" : ""}`} />
            {regenerating ? "Compiling…" : "Recompile"}
          </button>
        </div>
      </div>

      {/* Explainer — the compiled state of play */}
      {topic.content ? (
        <section className="mb-10 rounded-2xl border border-border bg-surface p-6">
          <TopicMarkdown content={topic.content} />
        </section>
      ) : (
        <section className="mb-10 rounded-2xl border border-border bg-surface px-6 py-12 text-center text-[14px] text-fg-3">
          This topic hasn&apos;t been compiled yet. Hit Recompile to generate the explainer.
        </section>
      )}

      {/* Tracked laws — live */}
      {entries.length > 0 && (
        <section className="mb-10">
          <SectionHeading icon={<Database className="h-4 w-4 text-fg-3" />} title="Tracked laws" count={entries.length} />
          <div className="space-y-2">
            {entries.map((entry) => (
              <Link
                key={entry.id}
                href={`/tracker/${entry.id}`}
                className="group flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 transition-all hover:border-border-hover"
              >
                <span className="text-base leading-none">{getFlag(entry.jurisdiction)}</span>
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium text-fg-2 group-hover:text-fg">
                    {entry.shortName}
                  </span>
                  {entry.nextKeyDate && (
                    <span className="block font-mono text-[10px] text-fg-3">
                      next: {formatDate(entry.nextKeyDate)}
                    </span>
                  )}
                </div>
                <StatusBadge status={entry.status} />
                <ImpactIndicator score={entry.impactScore} />
                <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-fg-3" />
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Recent stories — live from the digest via reference links */}
      {stories.length > 0 && (
        <section className="mb-10">
          <SectionHeading icon={<Newspaper className="h-4 w-4 text-fg-3" />} title="Recent stories" count={stories.length} />
          <div className="space-y-1">
            {stories.slice(0, 12).map((story) => {
              const href = story.issueSlug
                ? `/digest/issues/${story.issueSlug}#${story.id}`
                : story.url || "#";
              return (
                <Link
                  key={story.id}
                  href={href}
                  className="group flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-hover"
                >
                  <span className="w-[72px] flex-shrink-0 font-mono text-[11px] tabular-nums text-fg-3">
                    {formatDate(story.date)}
                  </span>
                  <span className="text-base leading-none">{getFlag(story.jurisdictionCode || "")}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg-2 group-hover:text-fg">
                    {story.title}
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-fg-3" />
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Active signals — live */}
      {signals.length > 0 && (
        <section className="mb-10">
          <SectionHeading icon={<Radar className="h-4 w-4 text-fg-3" />} title="Active signals" count={signals.length} />
          <div className="space-y-2">
            {signals.map((signal) => (
              <div key={signal.id} className="rounded-xl border border-border bg-surface px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="text-[14px] font-medium text-fg">{signal.title}</span>
                  <span className="rounded-full bg-hover px-2 py-0.5 font-mono text-[10px] text-fg-3">
                    {signal.trendDirection}
                  </span>
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-fg-2">{signal.summary}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function SectionHeading({ icon, title, count }: { icon: React.ReactNode; title: string; count: number }) {
  return (
    <div className="mb-3 flex items-center gap-2.5">
      {icon}
      <h2 className="text-[13px] font-semibold uppercase tracking-[0.04em] text-fg font-mono">{title}</h2>
      <span className="font-mono text-[11px] text-fg-3">{count}</span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}
