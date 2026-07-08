"use client";

import Link from "next/link";
import { useTopics } from "@/hooks/use-topics";
import { FreshnessBadge } from "@/components/library/freshness-badge";
import { BookOpen, Database, Newspaper, Radar } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonCard } from "@/components/ui/skeleton";

// Topics wiki index — the Library's front door. Each topic is a living,
// compiled dossier; freshness is always visible.
export default function TopicsPage() {
  const { data, isLoading } = useTopics();
  const topics = data?.topics || [];

  return (
    <div className="anim-enter">
      <div className="relative mb-8 grid-pattern py-4">
        <div className="relative z-10 flex items-center gap-2.5">
          <BookOpen className="h-5 w-5" style={{ color: "var(--accent)" }} />
          <h1 className="text-gradient text-[28px] font-bold tracking-[-0.02em]">Topics</h1>
        </div>
        <p className="relative z-10 mt-1.5 max-w-2xl text-[14px] text-fg-3">
          Living dossiers compiled from the tracker, digest, and signals.
          Regenerated, never hand-edited — freshness always shown.
        </p>
      </div>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 anim-enter" aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : topics.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="No topics yet"
          description={
            <>
              Seed them with{" "}
              <code className="font-mono text-[12px]">npx tsx scripts/archive/seed-topics.ts</code>.
            </>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 stagger">
          {topics.map((topic) => (
            <Link
              key={topic.slug}
              href={`/library/topics/${topic.slug}`}
              className="group rounded-2xl border border-border bg-surface p-5 transition-all hover:border-border-hover hover:shadow-[var(--shadow-card)]"
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-[16px] font-semibold leading-snug text-fg transition-colors group-hover:text-accent">
                  {topic.title}
                </h2>
                <FreshnessBadge stale={topic.stale} lastGenerated={topic.lastGenerated} />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3 font-mono text-[11px] text-fg-3">
                <span className="inline-flex items-center gap-1">
                  <Database className="h-3 w-3" /> {topic.entryCount} laws
                </span>
                <span className="inline-flex items-center gap-1">
                  <Newspaper className="h-3 w-3" /> {topic.storyCount} stories
                </span>
                {topic.signalCount > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <Radar className="h-3 w-3" /> {topic.signalCount} signals
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
