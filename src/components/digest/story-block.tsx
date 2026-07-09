"use client";

import { useState } from "react";
import { setStorySaved, type DigestStory } from "@/hooks/use-digest";
import { getFlag } from "@/lib/digest-utils";
import { TagBadge } from "./tag-badge";
import { StorySummary } from "./story-summary";
import { CopyButton } from "./copy-button";
import { StoryFollowup } from "./story-followup";
import { SourceFavicon } from "@/components/ui/source-favicon";
import { Clock, ChevronDown, Database, Star, Share2, Mail, EyeOff, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

type DraftFormat = "linkedin" | "email";


function sourceTypeColor(type: string): string {
  const map: Record<string, string> = {
    Regulator: "text-green-text",
    "Law Firm": "text-blue",
    Publication: "text-purple-text",
    Court: "text-amber-text",
  };
  return map[type] || "text-fg-3";
}

// The 4px stripe down the left edge of each story — lets a reader triage a
// full issue by colour before reading a word. Keyed to the same impact levels
// used elsewhere.
function impactColor(impact: string): string {
  switch (impact) {
    case "High": return "var(--red)";
    case "Medium": return "var(--amber)";
    default: return "var(--green)";
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
  // Voice-shifted share drafts (LinkedIn / email) — generated on demand.
  const [draftFormat, setDraftFormat] = useState<DraftFormat | null>(null);
  const [draftText, setDraftText] = useState("");
  const [drafting, setDrafting] = useState(false);
  // "Not relevant" feedback — inline reason form, writes to company-context.md.
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackReason, setFeedbackReason] = useState("");
  const [feedbackSending, setFeedbackSending] = useState(false);

  async function generateDraft(format: DraftFormat) {
    if (drafting) return;
    setDraftFormat(format);
    setDraftText("");
    setDrafting(true);
    try {
      const res = await fetch(`/api/digest/stories/${story.id}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format }),
      });
      const data = await res.json();
      if (!res.ok || !data.draft) throw new Error(data.error || "failed");
      setDraftText(data.draft);
    } catch {
      toast.error("Draft generation failed");
      setDraftFormat(null);
    } finally {
      setDrafting(false);
    }
  }

  async function submitFeedback() {
    if (feedbackSending) return;
    setFeedbackSending(true);
    try {
      const res = await fetch(`/api/digest/stories/${story.id}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: feedbackReason }),
      });
      if (!res.ok) throw new Error();
      toast.success("Noted — future digests will deprioritise similar stories");
      setFeedbackOpen(false);
      setFeedbackReason("");
    } catch {
      toast.error("Couldn't record feedback");
    } finally {
      setFeedbackSending(false);
    }
  }

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
      className="scroll-mt-20 rounded-xl border border-border bg-surface p-6 pl-5 transition-colors hover:border-border-hover cursor-pointer"
      style={{ borderLeftWidth: "4px", borderLeftColor: impactColor(story.impact || "Low") }}
      onClick={() => setExpanded(!expanded)}
    >
      {/* Badges */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {story.urgency === "immediate_action" && (
          <span className="rounded-full border border-red/20 bg-red-bg px-2 py-0.5 font-mono text-[10px] font-medium text-red-text">
            ACTION REQUIRED
          </span>
        )}
        {matchedRefCount > 0 && (
          <span
            className="inline-flex items-center gap-1 rounded-full border border-accent/20 bg-accent-bg px-2 py-0.5 font-mono text-[10px] font-medium text-accent-text"
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
        <span
          className="ml-auto font-mono text-[10px] uppercase tracking-[0.04em] text-fg-3"
          title={`Impact: ${story.impact || "Low"}`}
        >
          {story.impact || "Low"} impact
        </span>
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
            {story.url && story.url !== "#" && <SourceFavicon url={story.url} size={14} />}
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
              </div>

              {/* Share drafts + relevance feedback */}
              <div className="mt-3 flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => generateDraft("linkedin")}
                  disabled={drafting}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-elevated px-3 py-1 font-mono text-[10px] uppercase tracking-[0.04em] text-fg-2 transition-colors hover:border-border-hover hover:text-fg disabled:opacity-50"
                  title="Draft a LinkedIn post in your voice (copy-only, never auto-posted)"
                >
                  {drafting && draftFormat === "linkedin" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Share2 className="h-3 w-3" />}
                  LinkedIn draft
                </button>
                <button
                  onClick={() => generateDraft("email")}
                  disabled={drafting}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-elevated px-3 py-1 font-mono text-[10px] uppercase tracking-[0.04em] text-fg-2 transition-colors hover:border-border-hover hover:text-fg disabled:opacity-50"
                  title="Draft an internal stakeholder email"
                >
                  {drafting && draftFormat === "email" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Mail className="h-3 w-3" />}
                  Email draft
                </button>
                <button
                  onClick={() => setFeedbackOpen(!feedbackOpen)}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.04em] text-fg-3 transition-colors hover:border-red/30 hover:text-red"
                  title="Mark not relevant — teaches future triage to skip similar stories"
                >
                  <EyeOff className="h-3 w-3" />
                  Not relevant
                </button>
              </div>

              {feedbackOpen && (
                <div className="mt-2 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                  <input
                    value={feedbackReason}
                    onChange={(e) => setFeedbackReason(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && submitFeedback()}
                    placeholder="Why isn't this relevant? (optional — improves future triage)"
                    className="flex-1 rounded-lg border border-border bg-bg px-3 py-1.5 text-[13px] text-fg placeholder:text-fg-3 focus:border-accent focus:outline-none"
                    autoFocus
                  />
                  <button
                    onClick={submitFeedback}
                    disabled={feedbackSending}
                    className="rounded-lg bg-red/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.04em] text-red transition-colors hover:bg-red/20 disabled:opacity-50"
                  >
                    {feedbackSending ? "Saving…" : "Confirm"}
                  </button>
                </div>
              )}

              {draftFormat && (drafting || draftText) && (
                <div className="mt-3 rounded-lg border border-border bg-bg p-4" onClick={(e) => e.stopPropagation()}>
                  <div className="mb-2 flex items-center justify-between">
                    <h4 className="label-mono">
                      {draftFormat === "linkedin" ? "LinkedIn draft" : "Email draft"}
                    </h4>
                    <div className="flex items-center gap-2">
                      {draftText && (
                        <button
                          onClick={() => generateDraft(draftFormat)}
                          disabled={drafting}
                          className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.04em] text-fg-3 transition-colors hover:text-fg-2 disabled:opacity-50"
                          title="Regenerate"
                        >
                          <RefreshCw className="h-3 w-3" />
                          Redo
                        </button>
                      )}
                      {draftText && <CopyButton text={draftText} label="Copy" />}
                    </div>
                  </div>
                  {drafting ? (
                    <p className="flex items-center gap-2 text-[13px] text-fg-3">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Drafting…
                    </p>
                  ) : (
                    <textarea
                      value={draftText}
                      onChange={(e) => setDraftText(e.target.value)}
                      rows={Math.min(14, draftText.split("\n").length + 2)}
                      className="w-full resize-y rounded-lg border border-border bg-surface p-3 text-[13px] leading-relaxed text-fg-2 focus:border-accent focus:outline-none"
                      spellCheck={false}
                    />
                  )}
                </div>
              )}

              {/* Story-scoped follow-up — ask in place, stream inline, hand off
                  to Ask only when it deepens. Mounted only while expanded. */}
              {expanded && <StoryFollowup storyId={story.id} storyTitle={story.title} />}
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
