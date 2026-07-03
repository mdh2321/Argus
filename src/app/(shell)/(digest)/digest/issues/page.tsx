"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useDigestIssues } from "@/hooks/use-digest";
import { formatMonthLabel } from "@/lib/digest-utils";
import { IssueCardFull } from "@/components/digest/issue-card";
import { Loader2 } from "lucide-react";

export default function DigestIssuesPage() {
  const { data, isLoading } = useDigestIssues();
  const allIssues = useMemo(() => data?.issues || [], [data]);

  const { byMonth, months } = useMemo(() => {
    const grouped: Record<string, typeof allIssues> = {};
    for (const issue of allIssues) {
      const d = new Date(issue.date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(issue);
    }
    return { byMonth: grouped, months: Object.keys(grouped).sort().reverse() };
  }, [allIssues]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-fg-3" />
      </div>
    );
  }

  return (
    <div className="anim-enter flex gap-0 lg:gap-10">
      {/* Month sidebar */}
      <aside className="hidden w-52 shrink-0 lg:block">
        <div className="sticky top-20">
          <h2 className="label-mono mb-4">Archive</h2>

          <Link
            href="/digest/issues"
            className="mb-2 flex items-center gap-2 rounded-lg px-3 py-1.5 text-[13px] font-semibold text-fg transition-colors hover:bg-hover"
          >
            <span className="font-mono text-[11px] text-accent">{allIssues.length}</span>
            All issues
          </Link>

          <nav className="space-y-0.5">
            {months.map((key) => (
              <a
                key={key}
                href={`#month-${key}`}
                className="flex items-center justify-between rounded-lg px-3 py-1.5 text-[13px] text-fg-2 transition-colors hover:bg-hover hover:text-fg"
              >
                <span>{formatMonthLabel(key)}</span>
                <span className="font-mono text-[11px] text-fg-3">{byMonth[key].length}</span>
              </a>
            ))}
          </nav>
        </div>
      </aside>

      {/* Main content */}
      <div className="min-w-0 flex-1">
        <h1 className="mb-8 text-2xl font-bold text-fg">All Issues</h1>

        {months.map((key) => (
          <section key={key} id={`month-${key}`} className="mb-10 scroll-mt-20">
            <div className="mb-4 flex items-center gap-3">
              <h2 className="label-mono">{formatMonthLabel(key)}</h2>
              <span className="font-mono text-[10px] text-fg-3">
                {byMonth[key].length} issue{byMonth[key].length !== 1 ? "s" : ""}
              </span>
              <div className="h-px flex-1 bg-border" />
            </div>

            <div className="space-y-4 stagger">
              {byMonth[key].map((issue) => (
                <IssueCardFull key={issue.slug} issue={issue} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
