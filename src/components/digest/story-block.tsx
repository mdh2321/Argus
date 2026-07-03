"use client";

import { useState } from "react";
import Link from "next/link";
import { setStorySaved, type DigestStory } from "@/hooks/use-digest";
import { getFlag } from "@/lib/digest-utils";
import { TagBadge } from "./tag-badge";
import { StorySummary } from "./story-summary";
import { Clock, ChevronDown, Database, Star, Bot } from "lucide-react";
import { toast } from "sonner";


function sourceTypeColor(type: string): string {
  const map: Record<string, string> = {
    Regulator: "text-green",
    "Law Firm": "text-blue",
    Publication: "text-purple",
    Court: "text-amber",
  };
  return map[type] || "text-fg-3";
}

function impactDot(impact: string): string {
  switch (impact) {
    case "High": return "bg-red";
    case "Medium": return "bg-amber";
    default: return "bg-green";
  }
}

export function StoryBlock({
  story,
}: {
  story: DigestStory;
}) {
  const [expanded, setExpanded] = useState(false);
  // Optimistic star state — flipped immediately, rolled back on failure.
  const [saved, setSaved] = useState(!!story.saved);

  async function toggleSaved(e: React.MouseEvent) {
    e.stopPropagation();
    const next = !saved;
    setSaved(next);
    try {
      await setStorySaved(story.id, next);
    } catch {
      setSaved(!next);
      toast.error("Couldn't update saved stories");
    }
  }

  const matchedRefCount = story.references.filter((r) => r.status === "matched").length;
  const unmatchedRefCount = story.references.filter((r) => r.status === "unmatched").length;

  return (
    <article
      id={story.id}
      className="scroll-mt-20 rounded-xl border border-border bg-surface p-6 transition-colors hover:border-border-hover cursor-pointer"
      onClick={() => setExpanded(!expanded)}
    >
      {/* Badges */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {story.urgency === "immediate_action" && (
          <span className="rounded-full border border-red/20 bg-red-bg px-2 py-0.5 font-mono text-[10px] font-medium text-red">
            ACTION REQUIRED
          </span>
        )}
        {matchedRefCount > 0 && (
          <span
            className="inline-flex items-center gap-1 rounded-full border border-accent/20 bg-accent-bg px-2 py-0.5 font-mono text-[10px] font-medium text-accent"
            title={`${matchedRefCount} reference${matchedRefCount === 1 ? "" : "s"} linked to tracker`}
          >
            <Database className="h-2.5 w-2.5" />
            {matchedRefCount} tracked
          </span>
        )}
        {unmatchedRefCount > 0 && (
          <span
            className="rounded-full border border-border bg-bg-elevated px-2 py-0.5 font-mono text-[10px] text-fg-3"
            title={`${unmatchedRefCount} reference${unmatchedRefCount === 1 ? "" : "s"} not yet tracked — click underlined text to add`}
          >
            {unmatchedRefCount} untracked
          </span>
        )}
      </div>

      {/* Header + body in a shared column under the flag — keeps text width constant across collapsed/expanded states */}
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-xl leading-none">{getFlag(story.jurisdictionCode || "")}</span>
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-bold leading-snug text-fg">
            {story.url && story.url !== "#" ? (
              <a
                href={story.url}
                target="_blank"
                rel="noopener noreferrer"
                className="transition-colors hover:text-accent"
                onClick={(e) => e.stopPropagation()}
              >
                {story.title}
              </a>
            ) : (
              story.title
            )}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[11px] text-fg-3">
            <span className={`uppercase tracking-wide ${sourceTypeColor(story.sourceType)}`}>
              {story.sourceType}
            </span>
            <span>&middot;</span>
            {story.url && story.url !== "#" ? (
              <a
                href={story.url}
                target="_blank"
                rel="noopener noreferrer"
                className="transition-colors hover:text-accent"
                onClick={(e) => e.stopPropagation()}
              >
                {story.source} &#x2197;
              </a>
            ) : (
              <span>{story.source}</span>
            )}
            <span>&middot;</span>
            <span>{new Date(story.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
            <span>&middot;</span>
            <span className="flex items-center gap-1.5">
              <span className="uppercase tracking-wide">Impact</span>
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${impactDot(story.impact || "Low")}`} />
              <span>{story.impact || "Low"}</span>
            </span>
          </div>

          {/* Summary with inline reference highlights. Clamps to 2 lines when collapsed. */}
          <StorySummary
            summary={story.summary}
            references={story.references}
            expanded={expanded}
          />


          {/* Expanded extras (takeaways, deadline, tags) */}
          <div
            className={`grid transition-[grid-template-rows,opacity] duration-300 ease-in-out ${
              expanded ? "grid-rows-[1fr] opacity-100 mt-4" : "grid-rows-[0fr] opacity-0"
            }`}
          >
            <div className="overflow-hidden">
              {story.takeaways.length > 0 && (
                <div className="mb-4 rounded-lg border border-border bg-bg p-4">
                  <h4 className="label-mono mb-2">Key Takeaways</h4>
                  <ul className="space-y-1.5">
                    {story.takeaways.map((t, i) => (
                      <li key={i} className="flex gap-2 text-[14px] leading-relaxed text-fg-2">
                        <span className="mt-0.5 text-accent">&rarr;</span>
                        <span>{t}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {story.complianceDeadline && (
                <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber/20 bg-amber-bg px-3 py-2 font-mono text-[12px] text-amber">
                  <Clock className="h-3.5 w-3.5" />
                  Compliance deadline: {new Date(story.complianceDeadline).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                {story.jurisdiction && <TagBadge name={story.jurisdiction} size="sm" linked />}
                {story.categories.map((cat) => (
                  <TagBadge key={cat} name={cat} size="sm" linked />
                ))}
                <Link
                  href={`/ask?scopeKind=story&scopeId=${story.id}&scopeLabel=${encodeURIComponent(story.title)}`}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.04em] text-accent transition-colors hover:bg-accent/20"
                  title="Ask Sentinel a follow-up about this story"
                >
                  <Bot className="h-3 w-3" />
                  Ask about this
                </Link>
              </div>
            </div>
          </div>
        </div>
        <div className="flex flex-shrink-0 flex-col items-center gap-2">
          <button
            onClick={toggleSaved}
            title={saved ? "Remove from saved" : "Save story"}
            aria-label={saved ? "Remove from saved" : "Save story"}
            className={`rounded-lg p-1 transition-colors hover:bg-hover ${
              saved ? "text-amber" : "text-fg-3 hover:text-fg-2"
            }`}
          >
            <Star className="h-4 w-4" fill={saved ? "currentColor" : "none"} />
          </button>
          <ChevronDown
            className={`w-4 h-4 text-fg-3 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
          />
        </div>
      </div>
    </article>
  );
}
