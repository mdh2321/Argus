"use client";

import { useState } from "react";
import { setStorySaved, type DigestStory } from "@/hooks/use-digest";
import { getFlag } from "@/lib/digest-utils";
import { TagBadge } from "./tag-badge";
import { StorySummary } from "./story-summary";
import { CopyButton } from "./copy-button";
import { StoryFollowup } from "./story-followup";
import { AddToMatterButton } from "@/components/shared/add-to-matter";
import { SourceFavicon } from "@/components/ui/source-favicon";
import { ImpactGlyph } from "./impact-glyph";
import { Clock, ChevronDown, Star, Share2, Mail, EyeOff, Loader2, RefreshCw, AlertTriangle, ThumbsUp } from "lucide-react";
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

export function StoryBlock({
  story,
  issueSlug,
}: {
  story: DigestStory;
  issueSlug?: string;
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
  // "More like this" — one-click positive signal, the counterpart to the
  // "Not relevant" reason form.
  const [positiveSent, setPositiveSent] = useState(false);

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

  async function sendPositive() {
    if (positiveSent) return;
    setPositiveSent(true);
    try {
      const res = await fetch(`/api/digest/stories/${story.id}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sentiment: "positive" }),
      });
      if (!res.ok) throw new Error();
      toast.success("Noted — future digests will surface more like this");
    } catch {
      setPositiveSent(false);
      toast.error("Couldn't record feedback");
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
  const hasLink = !!story.url && story.url !== "#";
  const dateLabel = new Date(story.date).toLocaleDateString("en-US", { month: "short", day: "numeric" });

  // Quiet ghost action — no border, hover fill. Used for the expanded action row.
  const ghostAction =
    "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.04em] text-fg-3 transition-colors hover:bg-hover hover:text-fg-2 disabled:opacity-50";

  return (
    <article
      id={story.id}
      className="scroll-mt-20 cursor-pointer rounded-xl bg-surface p-5 shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-card-hover)]"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {/* Headline — flush left, nothing pushing it in */}
          <h3 className="text-[17px] font-semibold leading-snug tracking-[-0.01em] text-fg">
            {hasLink ? (
              <a
                href={story.url!}
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

          {/* Meta — source identity on the left, status + impact on the right */}
          <div className="mt-1.5 flex items-center gap-2 font-mono text-[11px] text-fg-3">
            {hasLink && <SourceFavicon url={story.url} size={14} />}
            <span className="leading-none">{getFlag(story.jurisdictionCode || "")}</span>
            {hasLink ? (
              <a
                href={story.url!}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate transition-colors hover:text-accent"
                onClick={(e) => e.stopPropagation()}
              >
                {story.source}
              </a>
            ) : (
              <span className="truncate">{story.source}</span>
            )}
            <span className="opacity-50">&middot;</span>
            <span className="tnum flex-shrink-0">{dateLabel}</span>

            <span className="ml-auto flex flex-shrink-0 items-center gap-2.5">
              {matchedRefCount > 0 && (
                <span className="text-accent-text" title={`${matchedRefCount} linked to tracker`}>
                  {matchedRefCount} tracked
                </span>
              )}
              {story.urgency === "immediate_action" && (
                <span title="Action required" aria-label="Action required" className="inline-flex">
                  <AlertTriangle className="h-3.5 w-3.5 text-red-text" />
                </span>
              )}
              <ImpactGlyph impact={story.impact} />
            </span>
          </div>

          {/* Summary with inline reference highlights. Clamps to 2 lines when collapsed. */}
          <StorySummary summary={story.summary} references={story.references} expanded={expanded} />

          {/* Expanded extras */}
          <div
            className={`grid transition-[grid-template-rows,opacity] duration-300 ease-in-out ${
              expanded ? "mt-4 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
            }`}
          >
            <div className="overflow-hidden">
              {story.takeaways.length > 0 && (
                <div className="mb-4">
                  <h4 className="label-mono mb-2">Key takeaways</h4>
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

              {/* Deadline + source detail — quiet inline chips, not boxes */}
              <div className="mb-4 flex flex-wrap items-center gap-2">
                {story.complianceDeadline && (
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-bg px-2.5 py-1 font-mono text-[11px] text-amber-text">
                    <Clock className="h-3.5 w-3.5" />
                    Deadline{" "}
                    {new Date(story.complianceDeadline).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                )}
                <span className={`font-mono text-[11px] uppercase tracking-[0.04em] ${sourceTypeColor(story.sourceType)}`}>
                  {story.sourceType}
                </span>
                {unmatchedRefCount > 0 && (
                  <span className="font-mono text-[11px] text-fg-3" title="Click underlined text in the summary to track">
                    {unmatchedRefCount} untracked reference{unmatchedRefCount === 1 ? "" : "s"}
                  </span>
                )}
              </div>

              {/* Tags — fill chips */}
              <div className="flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                {story.jurisdiction && <TagBadge name={story.jurisdiction} size="sm" linked />}
                {story.categories.map((cat) => (
                  <TagBadge key={cat} name={cat} size="sm" linked />
                ))}
              </div>

              {/* Actions — one quiet row under a hairline */}
              <div
                className="mt-4 flex flex-wrap items-center gap-1 border-t border-border pt-3"
                onClick={(e) => e.stopPropagation()}
              >
                <AddToMatterButton
                  kind="story"
                  refId={story.id}
                  label={story.title}
                  href={issueSlug ? `/digest/issues/${issueSlug}#${story.id}` : "/digest"}
                  className={ghostAction}
                />
                <button onClick={() => generateDraft("linkedin")} disabled={drafting} className={ghostAction} title="Draft a LinkedIn post in your voice (copy-only, never auto-posted)">
                  {drafting && draftFormat === "linkedin" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Share2 className="h-3 w-3" />}
                  LinkedIn draft
                </button>
                <button onClick={() => generateDraft("email")} disabled={drafting} className={ghostAction} title="Draft an internal stakeholder email">
                  {drafting && draftFormat === "email" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Mail className="h-3 w-3" />}
                  Email draft
                </button>
                <button
                  onClick={sendPositive}
                  disabled={positiveSent}
                  className={`${ghostAction} ml-auto hover:text-green`}
                  title="Surface more stories like this in future digests"
                >
                  <ThumbsUp className="h-3 w-3" />
                  {positiveSent ? "Noted" : "More like this"}
                </button>
                <button
                  onClick={() => setFeedbackOpen(!feedbackOpen)}
                  className={`${ghostAction} hover:text-red`}
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
                <div className="mt-3 rounded-lg bg-bg p-4" onClick={(e) => e.stopPropagation()}>
                  <div className="mb-2 flex items-center justify-between">
                    <h4 className="label-mono">{draftFormat === "linkedin" ? "LinkedIn draft" : "Email draft"}</h4>
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
            className={`h-4 w-4 text-fg-3 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
          />
        </div>
      </div>
    </article>
  );
}
