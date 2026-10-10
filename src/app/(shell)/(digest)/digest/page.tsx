"use client";

import Link from "next/link";
import { useState } from "react";
import { useDigestIssues, type DigestStory } from "@/hooks/use-digest";
import { StoryRow } from "@/components/digest/story-row";
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
  const { data, isLoading, error } = useDigestIssues({ limit: 7 });
  const issues = data?.issues || [];
  const latest = issues[0];
  const recent = issues.slice(1);

  const ranked = rankStories(latest?.stories || []);

  // Jurisdiction filter tabs — only the ones actually present in this issue.
  const jurisdictions = [...new Set(ranked.map(s => s.jurisdictionCode).filter((code): code is string => !!code))];

  const filtered = jur ? ranked.filter((s) => s.jurisdictionCode === jur) : ranked;


  return (
    <>
      <div className="anim-enter">
        <header className="mb-9 flex items-start justify-between gap-5">
          <div><p className="page-kicker mb-3">The intelligence briefing</p><h1 className="page-title">Digest</h1><p className="mt-3 text-[16px] text-fg-3">{latest ? `${latest.weekOf} · ${latest.storyCount} stories · ${latest.readTime} min read` : "The developments worth your attention."}</p></div>
          <button onClick={() => setSearchOpen(true)} className="argus-secondary"><Search size={16} />Search issues</button>
        </header>

        {error && <p role="alert" className="mb-5 text-red-text">The digest couldn’t be loaded. Try refreshing.</p>}
        {isLoading ? (
          <SkeletonCards count={4} />
        ) : !latest ? (
          <EmptyState
            icon={BookOpen}
            title="No digest issues yet"
            description="Your published briefings will appear here."
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

            <section className="mb-8 border-t border-border">
              {filtered.map(story => <StoryRow key={story.id} story={story} issueSlug={latest.slug} />)}
              <Link href={`/digest/issues/${latest.slug}`} className="argus-primary mt-7">Read the full issue<ArrowRight size={16} /></Link>
            </section>

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
                <ul className="divide-y divide-border border-t border-border">
                  {recent.map((issue) => (
                    <li key={issue.slug}><Link href={`/digest/issues/${issue.slug}`} className="group flex items-center gap-6 py-5"><span className="w-28 shrink-0 text-[13px] text-fg-3">{issue.date}</span><span className="min-w-0 flex-1 text-[17px] text-fg group-hover:text-accent-text">{issue.title}</span><span className="text-[13px] text-fg-3">{issue.storyCount} stories →</span></Link></li>
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
