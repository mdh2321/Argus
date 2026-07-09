"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useDigestIssues, type DigestStory } from "@/hooks/use-digest";
import { IssueCardCompact } from "@/components/digest/issue-card";
import { StoryFeedCard } from "@/components/digest/story-feed-card";
import { DigestSearchDialog } from "@/components/digest/search-dialog";
import { GapNudge } from "@/components/digest/gap-nudge";
import { getFlag } from "@/lib/digest-utils";
import { Search, BookOpen, ArrowRight } from "lucide-react";
import { SkeletonCards } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";

const IMPACT_RANK: Record<string, number> = { High: 3, Medium: 2, Low: 1 };

function rankStories(stories: DigestStory[]): DigestStory[] {
  return [...stories].sort((a, b) => {
    const byImpact = (IMPACT_RANK[b.impact || "Low"] || 0) - (IMPACT_RANK[a.impact || "Low"] || 0);
    if (byImpact !== 0) return byImpact;
    return b.date.localeCompare(a.date);
  });
}

export default function DigestPage() {
  const [searchOpen, setSearchOpen] = useState(false);
  const [jur, setJur] = useState<string | null>(null);
  const { data, isLoading } = useDigestIssues({ limit: 7 });
  const issues = data?.issues || [];
  const latest = issues[0];
  const recent = issues.slice(1);

  const ranked = useMemo(() => rankStories(latest?.stories || []), [latest]);

  // Jurisdiction filter tabs — only the ones actually present in this issue.
  const jurisdictions = useMemo(() => {
    const seen = new Set<string>();
    for (const s of ranked) if (s.jurisdictionCode) seen.add(s.jurisdictionCode);
    return [...seen];
  }, [ranked]);

  const filtered = jur ? ranked.filter((s) => s.jurisdictionCode === jur) : ranked;
  const [hero, ...rest] = filtered;

  return (
    <>
      <div className="anim-enter">
        {/* Header */}
        <div className="mb-6 flex items-start justify-between gap-4">
          <div className="relative grid-pattern py-4">
            <div className="relative z-10 flex items-center gap-2.5">
              <BookOpen className="h-5 w-5" style={{ color: "var(--purple)" }} />
              <h1 className="text-gradient text-[28px] font-bold tracking-[-0.02em]">Digest</h1>
            </div>
            {latest ? (
              <p className="relative z-10 mt-1.5 font-mono text-[12px] text-fg-3">
                {latest.weekOf} &middot; {latest.storyCount} stories &middot; {latest.jurisdictionCount} jurisdictions &middot; {latest.readTime} min read
              </p>
            ) : (
              <p className="relative z-10 mt-1.5 text-[14px] text-fg-3">Weekly intelligence for APAC tech law</p>
            )}
          </div>
          <button
            onClick={() => setSearchOpen(true)}
            className="flex h-8 flex-shrink-0 items-center gap-2 rounded-lg border border-border bg-transparent px-3 text-[13px] text-fg-3 transition-colors hover:border-border-hover hover:text-fg-2"
          >
            <Search className="h-3.5 w-3.5" />
            Search
            <kbd className="rounded bg-hover px-1.5 py-0.5 font-mono text-[10px] text-fg-3">&#x2318;K</kbd>
          </button>
        </div>

        {isLoading ? (
          <SkeletonCards count={4} />
        ) : !latest ? (
          <EmptyState
            icon={BookOpen}
            title="No digest issues yet"
            description="The weekly digest generates automatically each morning. Run one now with npm run digest:ensure."
          />
        ) : (
          <>
            {/* Jurisdiction filter */}
            {jurisdictions.length > 1 && (
              <div className="mb-6 flex flex-wrap items-center gap-1.5">
                <FilterTab label="All" active={jur === null} onClick={() => setJur(null)} />
                {jurisdictions.map((code) => (
                  <FilterTab
                    key={code}
                    label={`${getFlag(code)} ${code}`}
                    active={jur === code}
                    onClick={() => setJur(code)}
                  />
                ))}
              </div>
            )}

            {/* Hero + grid feed */}
            {hero && (
              <section className="mb-8">
                <StoryFeedCard story={hero} issueSlug={latest.slug} hero />
                {rest.length > 0 && (
                  <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 stagger">
                    {rest.map((story) => (
                      <StoryFeedCard key={story.id} story={story} issueSlug={latest.slug} />
                    ))}
                  </div>
                )}
                <Link
                  href={`/digest/issues/${latest.slug}`}
                  className="mt-5 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.04em] text-accent-text transition-colors hover:text-accent"
                >
                  Read the full issue <ArrowRight className="h-3 w-3" />
                </Link>
              </section>
            )}

            {/* Gap suggestions: tracker entries worth adding */}
            <GapNudge />

            {/* Recent issues */}
            {recent.length > 0 && (
              <section className="mt-10">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="label-mono">Recent issues</h2>
                  <Link href="/digest/issues" className="label-mono transition-colors hover:text-accent">
                    see all &rarr;
                  </Link>
                </div>
                <ul className="space-y-2 stagger">
                  {recent.map((issue) => (
                    <IssueCardCompact key={issue.slug} issue={issue} />
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>

      <DigestSearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  );
}

function FilterTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-lg px-3 py-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.04em] transition-colors ${
        active ? "bg-hover text-fg" : "text-fg-3 hover:bg-hover hover:text-fg-2"
      }`}
    >
      {label}
    </button>
  );
}
