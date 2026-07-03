"use client";

import useSWR from "swr";
import { useEntries } from "@/hooks/use-entries";
import { useDeadlines } from "@/hooks/use-deadlines";
import { useSignals } from "@/hooks/use-signals";
import { useDigestIssues } from "@/hooks/use-digest";
import { workflowLabel } from "@/lib/agent-workflows";
import { getFlag } from "@/lib/digest-utils";
import { JurisdictionBadge } from "@/components/ui/jurisdiction-badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { ImpactIndicator } from "@/components/ui/impact-indicator";
import { AgentBadge } from "@/components/ui/agent-badge";
import { JURISDICTIONS } from "@/lib/constants";
import { computeTrustBadges } from "@/lib/trust-badges";
import { relativeTime } from "@/lib/utils";
import Link from "next/link";
import {
  ArrowRight,
  Radar,
  CalendarDays,
  Search,
  Newspaper,
} from "lucide-react";

export default function DashboardPage() {
  const { data: allData } = useEntries({ limit: "200" });
  const { data: recentData } = useEntries({
    sort: "updated_at",
    order: "desc",
    limit: "8",
  });
  const { data: deadlinesData } = useDeadlines();

  const { data: signalsData } = useSignals({ status: "active" });
  const { data: latestIssueData } = useDigestIssues({ status: "published", limit: 1, order: "desc" });

  const entries = allData?.entries || [];
  const recentEntries = recentData?.entries || [];
  const allDeadlines = deadlinesData?.deadlines || [];

  const total = allData?.total || 0;
  const inForce = entries.filter((e) => e.status === "in_force").length;
  const highImpact = entries.filter((e) => e.impactScore && e.impactScore >= 4).length;
  const pipeline = entries.filter(
    (e) => ["proposed", "consultation", "bill_introduced", "passed"].includes(e.status)
  ).length;

  // Upcoming dates: next 3 future dates
  const today = new Date().toISOString().split("T")[0];
  const upcomingDates = allDeadlines
    .filter((d) => d.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 3);

  // Signals: use AI-generated signals, fallback to derived
  const aiSignals = signalsData?.signals || [];
  const signals: Signal[] = aiSignals.length > 0
    ? [...aiSignals]
        .sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0))
        .map((s) => ({
          title: s.title,
          description: s.summary,
          link: s.link || undefined,
          linkLabel: s.linkLabel || undefined,
          relevanceScore: s.relevanceScore,
          relevanceRationale: s.relevanceRationale,
        }))
    : buildSignals(entries);

  // Top stories from latest digest
  const latestIssue = latestIssueData?.issues?.[0];
  const topStories = (latestIssue?.stories || [])
    .sort((a, b) => {
      const impactOrder: Record<string, number> = { High: 3, Medium: 2, Low: 1 };
      return (impactOrder[b.impact || "Low"] || 0) - (impactOrder[a.impact || "Low"] || 0);
    })
    .slice(0, 5);

  return (
    <div className="anim-enter">
      {/* Hero with grid pattern */}
      <div className="relative mb-14 grid-pattern py-4">
        <h1 className="text-gradient text-[36px] font-bold tracking-[-0.03em] leading-tight relative z-10">
          Legal Intelligence
        </h1>
        <p className="text-[15px] text-fg-3 mt-2.5 leading-relaxed max-w-lg relative z-10">
          Tracking legislation, regulation, and policy across the Asia-Pacific.
        </p>

        {/* Stats bar */}
        <div className="flex items-center gap-6 mt-6 relative z-10">
          <StatPill value={total} label="tracked" />
          <StatPill value={inForce} label="in force" color="var(--green)" />
          <StatPill value={highImpact} label="high impact" color="var(--red)" />
          <StatPill value={pipeline} label="in pipeline" color="var(--amber)" />
        </div>

        <TrustStrip />
      </div>

      {/* Ask Sentinel */}
      <Link
        href="/ask"
        className="group mb-14 flex items-center gap-3 rounded-full border border-border bg-surface px-4 py-3 transition-all duration-200 hover:border-accent hover:shadow-[0_0_0_1px_var(--accent)]"
      >
        <Search className="w-5 h-5 text-accent flex-shrink-0" />
        <span className="text-[15px] text-fg-3 group-hover:text-fg-2 transition-colors">
          Ask Sentinel anything…
        </span>
      </Link>

      {/* Top Stories */}
      {topStories.length > 0 && (
        <section className="mb-10">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Newspaper className="w-4 h-4" style={{ color: "var(--cyan)" }} />
              <h2 className="text-[13px] font-semibold text-fg uppercase tracking-[0.04em] font-mono">Top Stories</h2>
            </div>
            {latestIssue && (
              <Link
                href={`/digest/issues/${latestIssue.slug}`}
                className="font-mono text-[11px] tracking-[0.04em] uppercase text-accent hover:text-accent-2 flex items-center gap-1.5 transition-colors"
              >
                Full digest <ArrowRight className="w-3 h-3" />
              </Link>
            )}
          </div>
          <div className="space-y-1 stagger">
            {topStories.map((story) => {
              const impactColor = story.impact === "High" ? "var(--red)" : story.impact === "Medium" ? "var(--amber)" : "var(--green)";
              return (
                <Link
                  key={story.id}
                  href={`/digest/issues/${latestIssue?.slug}#${story.id}`}
                  className="group flex items-center gap-3 py-2.5 border-b border-border last:border-0 rounded-lg transition-all hover:bg-surface hover:border-transparent"
                >
                  <span className="text-sm leading-none flex-shrink-0">{getFlag(story.jurisdictionCode || "")}</span>
                  <div className="flex-1 min-w-0">
                    <span className="text-[13px] font-medium text-fg group-hover:text-accent transition-colors truncate block">
                      {story.title}
                    </span>
                    <span className="text-[11px] text-fg-3 line-clamp-1 mt-0.5 block">
                      {story.source} &middot; {new Date(story.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </span>
                  </div>
                  <span className="flex items-center gap-1 font-mono text-[10px] text-fg-3 flex-shrink-0">
                    <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: impactColor }} />
                    {story.impact || "Low"}
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Signals */}
      <section id="signals" className="mb-10">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <Radar className="w-4 h-4" style={{ color: "var(--amber)" }} />
            <h2 className="text-[13px] font-semibold text-fg uppercase tracking-[0.04em] font-mono">Signals</h2>
          </div>
          {aiSignals.length > 0 && (
            <AgentBadge
              workflow="signals"
              timestamp={aiSignals.reduce(
                (max, s) => (s.updatedAt > max ? s.updatedAt : max),
                aiSignals[0].updatedAt
              )}
            />
          )}
        </div>
        <div className="space-y-2 stagger">
          {signals.map((signal, i) => {
            const score = signal.relevanceScore;
            const scoreColor =
              score == null ? "var(--fg-3)"
                : score >= 75 ? "var(--red)"
                : score >= 50 ? "var(--amber)"
                : "var(--fg-3)";
            return (
              <div
                key={i}
                className="py-2 border-b border-border last:border-0"
              >
                <div className="flex items-baseline justify-between gap-4">
                  <div className="flex items-baseline gap-2 min-w-0">
                    {score != null && (
                      <span
                        className="font-mono text-[10px] tabular-nums flex-shrink-0"
                        style={{ color: scoreColor }}
                        title={`Relevance to you: ${score}/100`}
                      >
                        {score}
                      </span>
                    )}
                    <span className="text-[13px] font-medium text-fg">{signal.title}</span>
                  </div>
                  {signal.link && (
                    <Link
                      href={signal.link}
                      className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.04em] text-accent hover:text-accent-2 transition-colors flex-shrink-0"
                    >
                      {signal.linkLabel} <ArrowRight className="w-3 h-3" />
                    </Link>
                  )}
                </div>
                {signal.relevanceRationale && (
                  <span
                    className="text-[11px] leading-relaxed block mt-1 italic"
                    style={{ color: "var(--accent)" }}
                  >
                    Why for you &middot; {signal.relevanceRationale}
                  </span>
                )}
                <span className="text-[12px] text-fg-3 leading-relaxed block mt-0.5">
                  {signal.description}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Upcoming Dates */}
      <section className="mb-10">
        <div className="flex items-center gap-2 mb-3">
          <CalendarDays className="w-4 h-4" style={{ color: "var(--cyan)" }} />
          <h2 className="text-[13px] font-semibold text-fg uppercase tracking-[0.04em] font-mono">Upcoming Dates</h2>
        </div>
        {upcomingDates.length > 0 ? (
          <div className="space-y-1 stagger">
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
                  className="group flex items-center gap-3 py-2 border-b border-border last:border-0 rounded-lg transition-all hover:bg-surface hover:border-transparent"
                >
                  <span
                    className="font-mono text-[12px] tabular-nums font-medium w-10 text-left flex-shrink-0"
                    style={{
                      color: days <= 7 ? "var(--amber)" : days <= 30 ? "var(--cyan)" : "var(--fg-3)",
                    }}
                  >
                    {days}d
                  </span>

                  <span className="text-sm leading-none flex-shrink-0">{jur?.flag || "\u{1F30F}"}</span>

                  <div className="flex-1 min-w-0">
                    <span className="text-[13px] font-medium text-fg truncate block group-hover:text-accent transition-colors">
                      {d.entryShortName}
                    </span>
                  </div>
                  <span className="text-[11px] text-fg-3 flex-shrink-0">
                    {d.label} &middot; {dateStr}
                  </span>
                </Link>
              );
            })}
          </div>
        ) : (
          <p className="text-[13px] text-fg-3 py-4">No upcoming dates on the horizon.</p>
        )}
      </section>

      {/* Recent — clean list */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ArrowRight className="w-4 h-4" style={{ color: "var(--accent)" }} />
            <h2 className="text-[13px] font-semibold text-fg uppercase tracking-[0.04em] font-mono">Recent Activity</h2>
          </div>
          <Link
            href="/tracker"
            className="font-mono text-[11px] tracking-[0.04em] uppercase text-accent hover:text-accent-2 flex items-center gap-1.5 transition-colors"
          >
            All entries <ArrowRight className="w-3 h-3" />
          </Link>
        </div>

        <div className="stagger">
          {recentEntries.map((entry) => (
            <Link
              key={entry.id}
              href={`/tracker/${entry.id}`}
              className="group flex items-center gap-5 py-3.5 border-b border-border last:border-0 -mx-3 px-3 rounded-xl transition-all duration-200 hover:bg-surface hover:shadow-[var(--shadow-card)] hover:border-transparent"
            >
              <JurisdictionBadge code={entry.jurisdiction} />
              <div className="flex-1 min-w-0">
                <span className="text-[14px] font-medium text-fg group-hover:text-accent transition-colors duration-150 truncate block">
                  {entry.shortName}
                </span>
                <span className="text-[12px] text-fg-3 truncate block mt-0.5">
                  {entry.category}
                </span>
              </div>
              <StatusBadge status={entry.status} />
              <ImpactIndicator score={entry.impactScore} />
              {computeTrustBadges(entry).map((badge) => (
                <span
                  key={badge.label}
                  className={`rounded-full border px-1.5 py-0.5 font-mono text-[9px] font-medium ${badge.className}`}
                >
                  {badge.label}
                </span>
              ))}
              <span className="font-mono text-[11px] text-fg-3 tabular-nums w-16 text-right">
                {relativeTime(entry.updatedAt)}
              </span>
            </Link>
          ))}

          {recentEntries.length === 0 && (
            <p className="py-16 text-center text-[14px] text-fg-3">
              No entries yet.{" "}
              <Link href="/settings" className="text-accent hover:underline">
                Add one
              </Link>
            </p>
          )}
        </div>
      </section>
    </div>
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
    <div className="mt-4 flex items-center gap-2 relative z-10 font-mono text-[11px] tracking-[0.02em] text-fg-3">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
      {parts.join(" · ")}
    </div>
  );
}

function StatPill({
  value,
  label,
  color,
}: {
  value: number;
  label: string;
  color?: string;
}) {
  const c = color || "var(--fg)";
  return (
    <div className="flex items-baseline gap-1.5">
      <span
        className="font-mono text-[20px] font-semibold tabular-nums tracking-tight"
        style={{ color: c }}
      >
        {value}
      </span>
      <span className="font-mono text-[11px] tracking-[0.04em] uppercase text-fg-3">{label}</span>
    </div>
  );
}

interface Signal {
  title: string;
  description: string;
  link?: string;
  linkLabel?: string;
  relevanceScore?: number | null;
  relevanceRationale?: string | null;
}

function buildSignals(entries: { status: string; category: string; jurisdiction: string; impactScore: number | null }[]): Signal[] {
  const signals: Signal[] = [];

  // Signal 1: AI regulation momentum
  const aiEntries = entries.filter((e) =>
    e.category.toLowerCase().includes("ai") || e.category.toLowerCase().includes("emerging")
  );
  if (aiEntries.length > 0) {
    const aiJurisdictions = new Set(aiEntries.map((e) => e.jurisdiction));
    signals.push({
      title: "AI governance accelerating across APAC",
      description: `${aiEntries.length} AI-related regulatory developments tracked across ${aiJurisdictions.size} jurisdiction${aiJurisdictions.size !== 1 ? "s" : ""}. Multiple frameworks moving from voluntary to mandatory.`,
      link: "/tracker?category=AI+%26+Emerging+Technology",
      linkLabel: "View AI entries",
    });
  }

  // Signal 2: Enforcement activity
  const enforcement = entries.filter((e) => e.status === "enforcement");
  if (enforcement.length > 0) {
    signals.push({
      title: "Enforcement actions increasing",
      description: `${enforcement.length} active enforcement matter${enforcement.length !== 1 ? "s" : ""} across the region. Regulators demonstrating willingness to impose significant penalties on technology companies.`,
      link: "/tracker?status=enforcement",
      linkLabel: "View enforcement",
    });
  }

  // Signal 3: Privacy convergence
  const privacyEntries = entries.filter((e) =>
    e.category.toLowerCase().includes("privacy") || e.category.toLowerCase().includes("data protection")
  );
  if (privacyEntries.length > 0) {
    const privacyJurisdictions = new Set(privacyEntries.map((e) => e.jurisdiction));
    signals.push({
      title: "Privacy regimes converging on GDPR model",
      description: `${privacyJurisdictions.size} jurisdictions actively reforming privacy frameworks. Cross-border data transfer rules tightening, with adequacy assessments becoming the norm.`,
      link: "/tracker?category=Privacy+%26+Data+Protection",
      linkLabel: "View privacy entries",
    });
  }

  // Fallback signals if no entries exist yet
  if (signals.length === 0) {
    signals.push(
      {
        title: "AI governance accelerating across APAC",
        description: "Multiple jurisdictions moving AI frameworks from voluntary to mandatory. South Korea, Singapore, and Japan leading with sector-specific obligations.",
        link: "/digest",
        linkLabel: "Read digest",
      },
      {
        title: "Enforcement posture shifting",
        description: "Record penalties in Singapore and Australia signal regulatory maturity. Expect increased scrutiny of cloud security practices and data handling by SaaS providers.",
        link: "/digest",
        linkLabel: "Read digest",
      },
      {
        title: "Cross-border data transfer rules tightening",
        description: "Japan, India, and New Zealand all consulting on stricter cross-border transfer requirements. Adequacy assessments and contractual safeguards becoming baseline expectations.",
        link: "/digest",
        linkLabel: "Read digest",
      }
    );
  }

  return signals.slice(0, 3);
}
