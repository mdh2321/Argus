"use client";

import Link from "next/link";
import { use } from "react";
import { useDigestIssue } from "@/hooks/use-digest";
import { useHorizon } from "@/hooks/use-horizon";
import { getFlag, getJurisdictionName } from "@/lib/digest-utils";
import { StoryBlock } from "@/components/digest/story-block";
import { CopyButton } from "@/components/digest/copy-button";
import { Loader2, Telescope, ArrowRight } from "lucide-react";

export default function DigestIssuePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const { data, isLoading } = useDigestIssue(slug);
  const { data: horizonData } = useHorizon();
  const issue = data?.issue;
  const stories = data?.stories || [];

  // The issue links into live surfaces instead of re-synthesizing them: the
  // old "regulatory radar" section is now a pointer at the Horizon page.
  // Anchored on the API's `today` so render stays pure.
  const horizonToday = horizonData?.today ? new Date(horizonData.today).getTime() : null;
  const horizonNext90 = horizonToday === null
    ? 0
    : (horizonData?.items || []).filter((item) => {
        const days = (new Date(item.date).getTime() - horizonToday) / 86400000;
        return days >= 0 && days <= 90;
      }).length;

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-fg-3" />
      </div>
    );
  }

  if (!issue) {
    return (
      <div className="py-20 text-center text-fg-3">Issue not found.</div>
    );
  }

  // Group stories by jurisdiction, then sort each group by impact (High → Medium → Low)
  const impactRank: Record<string, number> = { High: 0, Medium: 1, Low: 2 };
  const byJurisdiction: Record<string, typeof stories> = {};
  for (const story of stories) {
    const code = story.jurisdictionCode || "OTHER";
    if (!byJurisdiction[code]) byJurisdiction[code] = [];
    byJurisdiction[code].push(story);
  }
  for (const code of Object.keys(byJurisdiction)) {
    byJurisdiction[code].sort(
      (a, b) => (impactRank[a.impact ?? ""] ?? 99) - (impactRank[b.impact ?? ""] ?? 99),
    );
  }
  const tier1 = ["AU", "SG", "JP"];
  const jurisdictionOrder = [
    ...tier1.filter((c) => byJurisdiction[c]),
    ...Object.keys(byJurisdiction).filter((c) => !tier1.includes(c)).sort(),
  ];

  return (
    <div className="anim-enter mx-auto max-w-3xl">
      {/* Breadcrumb */}
      <nav className="label-mono mb-6 flex items-center gap-2">
        <Link href="/digest" className="transition-colors hover:text-accent">Digest</Link>
        <span>&gt;</span>
        <Link href="/digest/issues" className="transition-colors hover:text-accent">Issues</Link>
        <span>&gt;</span>
        <span className="text-fg-2">{issue.title}</span>
      </nav>

      {/* Header */}
      <div className="mb-8">
        <div className="label-mono mb-2">
          apac legal digest / {issue.date}
        </div>
        <h1 className="mb-4 text-[2rem] font-bold leading-[1.15] text-fg">
          {issue.title}
        </h1>

        <div className="mb-4 flex flex-wrap items-center gap-3 font-mono text-[12px] text-fg-3">
          <span>Week of {issue.weekOf}</span>
          <span>&middot;</span>
          <span>{issue.readTime} min read</span>
          <span>&middot;</span>
          <span>{issue.storyCount} stories</span>
          <span>&middot;</span>
          <span>{issue.jurisdictionCount} jurisdictions</span>
        </div>

        <div className="flex gap-2">
          <CopyButton text={typeof window !== "undefined" ? window.location.href : ""} label="Copy Link" />
          <CopyButton text={`# ${issue.title}\n\n${issue.synopsis.map((s: string) => `- ${s}`).join("\n")}`} label="Copy MD" />
        </div>
      </div>

      {/* Synopsis */}
      <section className="mb-8 rounded-xl bg-surface p-6 shadow-[var(--shadow-card)]">
        <h2 className="label-mono mb-3">Synopsis</h2>
        <ul className="space-y-2">
          {issue.synopsis.map((s: string, i: number) => (
            <li key={i} className="flex gap-2 text-[15px] leading-relaxed text-fg-2">
              <span className="mt-0.5 font-semibold text-accent">&bull;</span>
              <span>{s}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Executive brief */}
      {issue.executiveBrief && (
        <section className="mb-8 rounded-xl bg-surface p-6 shadow-[var(--shadow-card)]">
          <h2 className="label-mono mb-3">Executive Brief</h2>
          <div className="space-y-3">
            {issue.executiveBrief
              .split(/\n+/)
              .filter((p: string) => p.trim())
              .map((paragraph: string, i: number) => (
                <p key={i} className="text-[15px] leading-relaxed text-fg-2">
                  {paragraph}
                </p>
              ))}
          </div>
        </section>
      )}

      {/* Live-surface pointer — replaces the old generated "regulatory radar" */}
      {horizonNext90 > 0 && (
        <Link
          href="/tracker/horizon"
          className="group mb-10 flex items-center gap-3 rounded-xl bg-surface px-5 py-3.5 shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-card-hover)]"
        >
          <Telescope className="h-4 w-4 flex-shrink-0" style={{ color: "var(--accent)" }} />
          <span className="text-[14px] text-fg-2">
            <span className="font-semibold text-fg">{horizonNext90} key date{horizonNext90 === 1 ? "" : "s"}</span>{" "}
            in the next 90 days on the live Horizon
          </span>
          <ArrowRight className="ml-auto h-4 w-4 text-fg-3 transition-transform group-hover:translate-x-0.5" />
        </Link>
      )}

      {/* Table of Contents — follows the grouped + impact-sorted render order */}
      <section className="mb-10 rounded-xl bg-surface p-6 shadow-[var(--shadow-card)]">
        <h2 className="label-mono mb-3">Contents</h2>
        <ol className="space-y-1">
          {jurisdictionOrder.flatMap((code) => byJurisdiction[code]).map((story, i) => (
            <li key={story.id}>
              <a
                href={`#${story.id}`}
                className="flex items-center gap-2.5 rounded-lg px-2 py-1 text-[14px] text-fg-2 transition-colors hover:bg-hover hover:text-fg"
              >
                <span className="w-5 text-right font-mono text-[11px] text-fg-3">{i + 1}</span>
                <span>{getFlag(story.jurisdictionCode || "")}</span>
                <span className="truncate">{story.title}</span>
              </a>
            </li>
          ))}
        </ol>
      </section>

      {/* Stories grouped by jurisdiction */}
      {jurisdictionOrder.map((code) => (
        <section key={code} className="mb-10">
          <div className="mb-4 flex items-center gap-3">
            <span className="text-xl">{getFlag(code)}</span>
            <h2 className="text-lg font-bold text-fg">{getJurisdictionName(code)}</h2>
            <span className="font-mono text-[11px] text-fg-3">
              {byJurisdiction[code].length} stor{byJurisdiction[code].length !== 1 ? "ies" : "y"}
            </span>
            <div className="h-px flex-1 bg-border" />
          </div>
          <div className="space-y-4">
            {byJurisdiction[code].map((story) => (
              <StoryBlock key={story.id} story={story} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

