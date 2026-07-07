"use client";

import Link from "next/link";
import { useState } from "react";
import { useDigestIssues } from "@/hooks/use-digest";
import { IssueCardCompact, IssueCardFull } from "@/components/digest/issue-card";
import { DigestSearchDialog } from "@/components/digest/search-dialog";
import { GapNudge } from "@/components/digest/gap-nudge";
import { Search, BookOpen } from "lucide-react";
import { SkeletonCards } from "@/components/ui/skeleton";

export default function DigestPage() {
  const [searchOpen, setSearchOpen] = useState(false);
  const { data, isLoading } = useDigestIssues({ limit: 7 });
  const issues = data?.issues || [];
  const latest = issues[0];
  const recent = issues.slice(1);

  return (
    <>
      <div className="anim-enter">
        {/* Header row with search */}
        <div className="mb-8 flex items-center justify-between">
          <div className="relative grid-pattern py-4">
            <div className="flex items-center gap-2.5 relative z-10">
              <BookOpen className="w-5 h-5" style={{ color: "var(--purple)" }} />
              <h1 className="text-gradient text-[28px] font-bold tracking-[-0.02em]">
                Digest
              </h1>
            </div>
            <p className="text-[14px] text-fg-3 mt-1.5 relative z-10">
              Weekly intelligence for APAC tech law
            </p>
          </div>
          <button
            onClick={() => setSearchOpen(true)}
            className="flex h-8 items-center gap-2 rounded-lg border border-border bg-transparent px-3 text-[13px] text-fg-3 transition-colors hover:border-border-hover hover:text-fg-2"
          >
            <Search className="h-3.5 w-3.5" />
            Search
            <kbd className="rounded bg-hover px-1.5 py-0.5 font-mono text-[10px] text-fg-3">
              &#x2318;K
            </kbd>
          </button>
        </div>

        {isLoading ? (
          <SkeletonCards count={4} />
        ) : issues.length === 0 ? (
          <div className="rounded-2xl border border-border bg-surface px-6 py-16 text-center text-[14px] text-fg-3">
            No digest issues yet. The weekly digest generates automatically each
            morning — or run one now with <code className="font-mono text-[12px]">npm run digest:ensure</code>.
          </div>
        ) : (
          <>
            {/* Featured latest issue */}
            {latest && (
              <section className="mb-10">
                <IssueCardFull issue={latest} />
              </section>
            )}

            {/* Gap suggestions: tracker entries worth adding */}
            <GapNudge />

            {/* Recent issues */}
            {recent.length > 0 && (
              <section>
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="label-mono">Recent Issues</h2>
                  <Link
                    href="/digest/issues"
                    className="label-mono transition-colors hover:text-accent"
                  >
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
