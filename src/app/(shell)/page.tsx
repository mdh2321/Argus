"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { useDeadlines } from "@/hooks/use-deadlines";
import { useSignals } from "@/hooks/use-signals";
import { useDigestIssues } from "@/hooks/use-digest";
import { workflowLabel } from "@/lib/agent-workflows";
import { AgentBadge } from "@/components/ui/agent-badge";
import { JURISDICTIONS, URGENCY } from "@/lib/constants";
import { DEADLINE_KIND_META } from "@/lib/deadline-kind";
import { relativeTime, calculateUrgency } from "@/lib/utils";
import { ReviewQueue } from "@/components/dashboard/review-queue";
import { StoryFeedCard } from "@/components/digest/story-feed-card";
import Link from "next/link";
import { ArrowRight, Radar, CalendarDays, Search, Newspaper } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

// The Briefing — reading-first dashboard. Decisions arrive in weekly bursts
// (post-digest), reading is the daily act, so the page leads with Ask and the
// latest stories; the review strip stays one quiet line until there's
// something to clear. Counts and recent-entry lists live on the Tracker.

const RELEVANCE_FLOOR = 50;

export default function DashboardPage() {
  const { data: deadlinesData } = useDeadlines();
  const { data: signalsData } = useSignals({ status: "active" });
  const { data: latestIssueData } = useDigestIssues({ status: "published", limit: 1, order: "desc" });

  const allDeadlines = deadlinesData?.deadlines || [];

  // Upcoming dates: next 3 future dates
  const today = new Date().toISOString().split("T")[0];
  const upcomingDates = allDeadlines
    .filter((d) => d.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 3);

  // Radar: only signals scored relevant to the profile — no generic filler.
  const aiSignals = signalsData?.signals || [];
  const radar = [...aiSignals]
    .filter((s) => (s.relevanceScore ?? 0) >= RELEVANCE_FLOOR)
    .sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0))
    .slice(0, 3);

  // Top stories from latest digest: one featured lead + three compact rows.
  const latestIssue = latestIssueData?.issues?.[0];
  const topStories = (latestIssue?.stories || [])
    .sort((a, b) => {
      const impactOrder: Record<string, number> = { High: 3, Medium: 2, Low: 1 };
      return (impactOrder[b.impact || "Low"] || 0) - (impactOrder[a.impact || "Low"] || 0);
    })
    .slice(0, 4);
  const [leadStory, ...restStories] = topStories;

  return (
    <div className="anim-enter">
      {/* Hero with grid pattern */}
      <div className="relative mb-8 grid-pattern py-4">
        <h1 className="text-gradient text-[36px] font-bold tracking-[-0.03em] leading-tight relative z-10">
          Legal Intelligence
        </h1>
        <p className="text-[15px] text-fg-3 mt-2.5 leading-relaxed max-w-lg relative z-10">
          Tracking legislation, regulation, and policy across the Asia-Pacific.
        </p>
      </div>

      <AskInput />

      {/* Review strip — pending decisions, one line until expanded (B1) */}
      <ReviewQueue />

      {/* Top Stories */}
      {leadStory && (
        <section className="mb-10">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Newspaper className="w-4 h-4" style={{ color: "var(--cyan)" }} />
              <h2 className="text-[13px] font-semibold text-fg uppercase tracking-[0.04em] font-mono">Top Stories</h2>
            </div>
            {latestIssue && (
              <Link
                href={`/digest/issues/${latestIssue.slug}`}
                className="font-mono text-[11px] tracking-[0.04em] uppercase text-accent-text hover:text-accent flex items-center gap-1.5 transition-colors"
              >
                Full digest <ArrowRight className="w-3 h-3" />
              </Link>
            )}
          </div>

          <StoryFeedCard story={leadStory} issueSlug={latestIssue?.slug ?? ""} hero />
          {restStories.length > 0 && (
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 stagger">
              {restStories.map((story) => (
                <StoryFeedCard key={story.id} story={story} issueSlug={latestIssue?.slug ?? ""} />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Radar — profile-scored signals only; absent when nothing qualifies */}
      {radar.length > 0 && (
        <section id="signals" className="mb-10">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <Radar className="w-4 h-4" style={{ color: "var(--amber)" }} />
              <h2 className="text-[13px] font-semibold text-fg uppercase tracking-[0.04em] font-mono">Radar</h2>
            </div>
            <AgentBadge
              workflow="signals"
              timestamp={aiSignals.reduce(
                (max, s) => (s.updatedAt > max ? s.updatedAt : max),
                aiSignals[0].updatedAt
              )}
            />
          </div>
          <div className="space-y-2 stagger">
            {radar.map((signal) => {
              const score = signal.relevanceScore ?? 0;
              const scoreColor =
                score >= 75 ? "var(--red)" : score >= 50 ? "var(--amber)" : "var(--fg-3)";
              return (
                <div key={signal.id} className="py-2 border-b border-border last:border-0">
                  <div className="flex items-baseline justify-between gap-4">
                    <div className="flex items-baseline gap-2 min-w-0">
                      <span
                        className="font-mono text-[10px] tabular-nums flex-shrink-0"
                        style={{ color: scoreColor }}
                        title={`Relevance to you: ${score}/100`}
                      >
                        {score}
                      </span>
                      <span className="text-[13px] font-medium text-fg">{signal.title}</span>
                    </div>
                    {signal.link && (
                      <Link
                        href={signal.link}
                        className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.04em] text-accent-text hover:text-accent transition-colors flex-shrink-0"
                      >
                        {signal.linkLabel || "View"} <ArrowRight className="w-3 h-3" />
                      </Link>
                    )}
                  </div>
                  {signal.relevanceRationale && (
                    <span
                      className="text-[11px] leading-relaxed block mt-1 italic"
                      style={{ color: "var(--accent-text)" }}
                    >
                      Why for you &middot; {signal.relevanceRationale}
                    </span>
                  )}
                  <span className="text-[12px] text-fg-3 leading-relaxed block mt-0.5">
                    {signal.summary}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Upcoming Dates */}
      <section className="mb-10">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <CalendarDays className="w-4 h-4" style={{ color: "var(--cyan)" }} />
            <h2 className="text-[13px] font-semibold text-fg uppercase tracking-[0.04em] font-mono">Upcoming Dates</h2>
          </div>
          <Link
            href="/tracker/horizon"
            className="font-mono text-[11px] tracking-[0.04em] uppercase text-accent-text hover:text-accent flex items-center gap-1.5 transition-colors"
          >
            Horizon <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
        {upcomingDates.length > 0 ? (
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3 stagger">
            {upcomingDates.map((d) => {
              const jur = JURISDICTIONS.find((j) => j.code === d.entryJurisdiction);
              const dateObj = new Date(d.date);
              const days = Math.ceil(
                (dateObj.getTime() - new Date(today).getTime()) / 86400000
              );
              const dateStr = dateObj.toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              });
              return (
                <Link
                  key={d.id}
                  href={`/tracker/${d.entryId}`}
                  className="group rounded-xl border border-border bg-surface px-4 py-3.5 transition-all hover:border-border-hover hover:shadow-[var(--shadow-card)]"
                >
                  <span
                    className="font-mono text-[20px] font-semibold tabular-nums tracking-tight block"
                    style={{ color: URGENCY[calculateUrgency(d.date)].color }}
                  >
                    {days}d
                  </span>
                  <span className="mt-1 flex items-center gap-1.5 text-[12.5px] font-medium text-fg group-hover:text-accent transition-colors">
                    <span className="text-sm leading-none">{jur?.flag || "\u{1F30F}"}</span>
                    <span className="truncate">{d.entryShortName}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-fg-3">
                    <span
                      className="font-mono uppercase tracking-[0.04em]"
                      style={{ color: DEADLINE_KIND_META[d.kind].color }}
                      title={DEADLINE_KIND_META[d.kind].description}
                    >
                      {DEADLINE_KIND_META[d.kind].label}
                    </span>{" "}
                    &middot; {d.label} &middot; {dateStr}
                  </span>
                </Link>
              );
            })}
          </div>
        ) : (
          <EmptyState
            size="sm"
            icon={CalendarDays}
            title="Nothing on the horizon"
            description="Upcoming key dates from your tracked entries will appear here."
          />
        )}
      </section>

      <TrustStrip />
    </div>
  );
}

// Real Ask entry point: submitting navigates to /ask with the question
// seeded via ?q=, which the Ask page auto-runs.
function AskInput() {
  const router = useRouter();
  const [q, setQ] = useState("");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = q.trim();
        router.push(trimmed ? `/ask?q=${encodeURIComponent(trimmed)}` : "/ask");
      }}
      className="group mb-6 flex items-center gap-3 rounded-full border border-border bg-surface px-4 py-3 transition-all duration-200 focus-within:border-accent focus-within:shadow-[0_0_0_1px_var(--accent)] hover:border-accent"
    >
      <Search className="w-5 h-5 text-accent flex-shrink-0" />
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Ask Argus anything…"
        aria-label="Ask Argus"
        className="flex-1 bg-transparent text-[15px] text-fg placeholder:text-fg-3 outline-none"
      />
      <kbd className="hidden sm:block rounded bg-hover px-1.5 py-0.5 font-mono text-[10px] text-fg-3">
        ↵
      </kbd>
    </form>
  );
}

interface SystemHealth {
  groundedEntries: number;
  sourceDocs: number;
  lastDigestDeliveredAt: string | null;
  lastAgentRunAt: string | null;
  lastAgentWorkflow: string | null;
}

// Trust strip: proof the desk is alive and grounded, in one quiet line.
function TrustStrip() {
  const { data } = useSWR<SystemHealth>("/api/system-health", (url: string) =>
    fetch(url).then((r) => r.json())
  );
  if (!data) return null;

  const parts: string[] = [
    `${data.groundedEntries} grounded entries`,
    `${data.sourceDocs} sources on file`,
  ];
  if (data.lastDigestDeliveredAt) {
    parts.push(`digest delivered ${relativeTime(data.lastDigestDeliveredAt)}`);
  }
  if (data.lastAgentRunAt) {
    parts.push(
      `last agent run ${relativeTime(data.lastAgentRunAt)}${data.lastAgentWorkflow ? ` (${workflowLabel(data.lastAgentWorkflow)})` : ""}`
    );
  }

  return (
    <div className="flex items-center gap-2 border-t border-border pt-4 font-mono text-[11px] tracking-[0.02em] text-fg-3">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
      {parts.join(" · ")}
    </div>
  );
}
