"use client";

/**
 * Ask answer widgets (Phases 0/2/3/5/6/7): confidence banner, degradation
 * chips, the "How Argus answered this" trace expander, paragraph blocks with
 * per-paragraph citation popovers, the Verify button, and the feedback bar.
 * One popover component serves paragraph chips and source rows alike.
 */

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  ExternalLink,
  Globe,
  LoaderCircle,
  Quote,
  ShieldCheck,
  ThumbsDown,
  ThumbsUp,
  X,
} from "lucide-react";
import type {
  AskAnswerTrace,
  AskArgusAnswer,
  AskArgusCitation,
  AskConfidence,
  AskFeedbackReason,
  AskParagraph,
  AskVerification,
} from "@/lib/ask-types";

// ── Confidence ──────────────────────────────────────────────────

const CONFIDENCE_COLOR: Record<AskConfidence, string> = {
  high: "var(--green)",
  medium: "var(--amber)",
  low: "var(--red)",
};

export function ConfidenceChip({ confidence, title }: { confidence: AskConfidence; title?: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide"
      style={{ color: CONFIDENCE_COLOR[confidence], background: "color-mix(in srgb, currentColor 12%, transparent)" }}
      title={title || `Computed from grounding × source authority`}
    >
      {confidence}
    </span>
  );
}

/** Whole-answer banner: weakest load-bearing block + grounded counts. */
export function ConfidenceBanner({ answer }: { answer: AskArgusAnswer }) {
  const blocks: { confidence: AskConfidence; grounded: boolean }[] =
    answer.paragraphs?.map((p) => ({ confidence: p.confidence, grounded: p.sourceIds.length > 0 })) ??
    answer.reportSections?.flatMap((s) =>
      (s.claims || []).map((c) => ({ confidence: c.confidence, grounded: c.groundingType !== "ai_knowledge" }))
    ) ??
    [];
  const grounded = blocks.filter((b) => b.grounded).length;

  return (
    <span
      className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.04em]"
      style={{ color: CONFIDENCE_COLOR[answer.confidence] }}
      title="Overall confidence is the weakest load-bearing paragraph — computed from what grounded each claim, not self-reported."
    >
      {answer.confidence} confidence
      {blocks.length > 0 && (
        <span className="text-fg-3">
          · {grounded}/{blocks.length} grounded
        </span>
      )}
    </span>
  );
}

// ── Degradation chips + web badge (Phase 0.2 / 3) ───────────────

export function DegradationChips({ trace }: { trace?: AskAnswerTrace }) {
  if (!trace || trace.degraded.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {trace.degraded.map((note) => (
        <span
          key={note}
          className="inline-flex items-center gap-1.5 rounded-lg border border-amber/30 bg-amber-bg px-2 py-1 text-[11px] text-amber-text"
        >
          <AlertTriangle className="h-3 w-3 flex-shrink-0" />
          {note}
        </span>
      ))}
    </div>
  );
}

export function WebBadge({ trace }: { trace?: AskAnswerTrace }) {
  if (!trace) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.04em] ${
        trace.webUsed ? "text-cyan" : "text-fg-3"
      }`}
      title={
        trace.webUsed
          ? `Web research ran (${trace.webSearches} tool call${trace.webSearches === 1 ? "" : "s"})`
          : `Web: ${trace.webMode}`
      }
    >
      <Globe className="h-3 w-3" />
      {trace.webUsed ? `web · ${trace.webSearches}` : `web ${trace.webMode}`}
    </span>
  );
}

// ── Trace expander (Phase 0.2) ──────────────────────────────────

const GROUNDING_LABEL: Record<string, string> = {
  stored_doc: "stored document",
  cached_fetch: "cached fetch",
  live_fetch: "live fetch",
  record_only: "record only",
};

const RETRIEVAL_LABEL: Record<string, string> = {
  fts: "lexical match",
  fts_expanded: "lexical match (query expanded)",
  impact_fallback: "impact fallback — no lexical matches",
  scoped: "scoped to selected sources",
};

export function TraceExpander({ trace }: { trace?: AskAnswerTrace }) {
  const [open, setOpen] = useState(false);
  if (!trace) return null;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.04em] text-fg-3 transition-colors hover:text-fg-2"
      >
        <ChevronRight className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`} />
        How Argus answered this
      </button>
      {open && (
        <div className="mt-2 space-y-2 rounded-xl border border-border bg-bg px-3.5 py-3 text-[12px] text-fg-2">
          <div>
            <span className="text-fg-3">Retrieval:</span> {RETRIEVAL_LABEL[trace.retrieval.mode] ?? trace.retrieval.mode}
            {" · "}
            {trace.retrieval.matched} matched of {trace.retrieval.considered} considered
          </div>
          {trace.sources.length > 0 && (
            <div>
              <span className="text-fg-3">Sources consulted:</span>
              <ul className="mt-1 space-y-0.5">
                {trace.sources.map((s) => (
                  <li key={s.id} className="flex items-center gap-2">
                    <span className="truncate">{s.label}</span>
                    <span
                      className={`flex-shrink-0 rounded px-1 py-px font-mono text-[9px] uppercase ${
                        s.grounding === "record_only" ? "bg-hover text-fg-3" : "bg-accent/10 text-accent"
                      }`}
                    >
                      {GROUNDING_LABEL[s.grounding]}
                    </span>
                    {s.fetchFailed && (
                      <span className="flex-shrink-0 rounded bg-red-bg px-1 py-px font-mono text-[9px] uppercase text-red">
                        fetch failed
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {trace.scopesDropped.length > 0 && (
            <div className="text-red">Not found: {trace.scopesDropped.join(", ")}</div>
          )}
          <div>
            <span className="text-fg-3">Stages:</span>{" "}
            {trace.stages.map((s) => `${s.name} ${(s.ms / 1000).toFixed(1)}s`).join(" → ")}
          </div>
          <div className="font-mono text-[10px] text-fg-3">
            synthesis {trace.models.synthesis}
            {trace.models.research ? ` · research ${trace.models.research}` : ""}
            {" · "}web {trace.webMode}
            {trace.webUsed ? ` (${trace.webSearches} calls)` : ""}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Unified citation popover (Phase 7) ──────────────────────────

export function CitationPopover({
  citation,
  pin,
  onClose,
}: {
  citation: AskArgusCitation;
  /** Paragraph-level pin (overrides the citation's own pin when present). */
  pin?: (AskParagraph["pin"]) | null;
  onClose: () => void;
}) {
  const effectivePin = pin ?? (citation.pin ? { ...citation.pin, entryId: citation.id } : null);
  const pinHref = effectivePin
    ? `/tracker/${effectivePin.entryId}?revealDoc=${encodeURIComponent(effectivePin.sourceDocumentId)}${
        typeof effectivePin.quoteStart === "number" && typeof effectivePin.quoteEnd === "number"
          ? `&quoteStart=${effectivePin.quoteStart}&quoteEnd=${effectivePin.quoteEnd}`
          : ""
      }${effectivePin.sectionRef ? `&sectionRef=${encodeURIComponent(effectivePin.sectionRef)}` : ""}`
    : null;

  return (
    <div className="absolute left-0 top-full z-30 mt-1.5 w-[340px] rounded-xl border border-border bg-surface p-3 shadow-[var(--shadow-l)]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-fg">{citation.title}</div>
          <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.03em] text-fg-3">
            {citation.meta}
            {citation.tier ? ` · ${citation.tier.replace(/_/g, " ")}` : ""}
          </div>
        </div>
        <button onClick={onClose} className="flex-shrink-0 rounded p-0.5 text-fg-3 hover:text-fg">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {effectivePin && (
        <div className="mt-2 rounded-md border border-border bg-bg px-2.5 py-1.5">
          <div className="mb-1 inline-flex items-center gap-1 text-[10px] text-fg-3">
            <Quote className="h-2.5 w-2.5" />
            {effectivePin.quoteVerified ? "Verified passage" : "Cited passage"}
            {effectivePin.sectionRef && <span className="font-mono">· {effectivePin.sectionRef}</span>}
          </div>
          <blockquote className="border-l-2 border-accent/40 pl-2 text-[11px] italic text-fg-2">
            &ldquo;{effectivePin.quote}&rdquo;
          </blockquote>
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-3">
        {pinHref ? (
          <Link href={pinHref} className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline">
            <ExternalLink className="h-2.5 w-2.5" />
            View passage in source
          </Link>
        ) : (
          citation.kind !== "web" && (
            <Link href={citation.href} className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline">
              Open in Argus
            </Link>
          )
        )}
        {citation.externalUrl && (
          <a
            href={citation.externalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-fg-3 hover:text-fg-2"
          >
            Source link <ExternalLink className="h-2.5 w-2.5" />
          </a>
        )}
      </div>
    </div>
  );
}

// ── Verification badges (Phase 5) ───────────────────────────────

const VERDICT_META: Record<string, { label: string; color: string }> = {
  supported: { label: "✓ verified", color: "var(--green)" },
  partially_supported: { label: "~ partial", color: "var(--amber)" },
  unsupported: { label: "✗ unsupported", color: "var(--red)" },
  contradicted: { label: "✗ contradicted", color: "var(--red)" },
  unverifiable: { label: "○ unverifiable", color: "var(--fg-3)" },
};

export function VerificationChip({ verification }: { verification?: AskVerification }) {
  if (!verification) return null;
  const meta = VERDICT_META[verification.verdict] ?? VERDICT_META.unverifiable;
  return (
    <span
      className="inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide"
      style={{ color: meta.color, background: "color-mix(in srgb, currentColor 12%, transparent)" }}
      title={verification.reason || undefined}
    >
      {meta.label}
    </span>
  );
}

// ── Paragraph blocks (Phase 2) ──────────────────────────────────

const GROUNDING_COLORS: Record<string, string> = {
  direct_quote: "var(--green)",
  paraphrase: "var(--cyan)",
  inference: "var(--amber)",
  ai_knowledge: "var(--red)",
};

export function ParagraphList({
  paragraphs,
  citations,
}: {
  paragraphs: AskParagraph[];
  citations: AskArgusCitation[];
}) {
  const indexById = new Map(citations.map((c, i) => [c.id, i + 1]));
  const citationsById = new Map(citations.map((c) => [c.id, c]));

  return (
    <div className="space-y-4">
      {paragraphs.map((p, i) => (
        <ParagraphBlock
          key={i}
          paragraph={p}
          indexById={indexById}
          citationsById={citationsById}
        />
      ))}
    </div>
  );
}

function ParagraphBlock({
  paragraph,
  indexById,
  citationsById,
}: {
  paragraph: AskParagraph;
  indexById: Map<string, number>;
  citationsById: Map<string, AskArgusCitation>;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div>
      <p className="text-[15px] leading-relaxed text-fg-2">{paragraph.text}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {paragraph.sourceIds.map((id) => {
          const citation = citationsById.get(id);
          if (!citation) return null;
          const n = indexById.get(id);
          return (
            <span key={id} className="relative">
              <button
                type="button"
                onClick={() => setOpenId(openId === id ? null : id)}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-1.5 py-0.5 text-[10px] text-fg-3 transition-colors hover:border-border-hover hover:text-fg-2"
                title={citation.title}
              >
                <span className="font-mono">[{n}]</span>
                <span className="max-w-[140px] truncate">{citation.sourceLabel}</span>
              </button>
              {openId === id && (
                <CitationPopover
                  citation={citation}
                  pin={paragraph.pin && paragraph.pin.entryId === id ? paragraph.pin : null}
                  onClose={() => setOpenId(null)}
                />
              )}
            </span>
          );
        })}
        <span
          className="font-mono text-[9px] uppercase tracking-wide"
          style={{ color: GROUNDING_COLORS[paragraph.groundingType] || "var(--fg-3)" }}
          title={paragraph.sourceIds.length === 0 ? "Not backed by any tracked record" : undefined}
        >
          {paragraph.groundingType.replace("_", " ")}
        </span>
        <ConfidenceChip confidence={paragraph.confidence} />
        <VerificationChip verification={paragraph.verification} />
      </div>
    </div>
  );
}

// ── Verify button (Phase 5) ─────────────────────────────────────

export function VerifyButton({
  messageId,
  verifiedAt,
  onVerified,
}: {
  messageId?: string;
  verifiedAt?: string;
  onVerified: (answer: AskArgusAnswer) => void;
}) {
  const [busy, setBusy] = useState(false);
  if (!messageId) return null;

  async function run() {
    setBusy(true);
    try {
      const res = await fetch("/api/ask/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId }),
      });
      if (!res.ok) throw new Error("verify failed");
      const data = (await res.json()) as { answer: AskArgusAnswer };
      onVerified(data.answer);
      toast.success("Sources verified — see the per-paragraph verdicts");
    } catch {
      toast.error("Couldn't verify this answer");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={() => void run()}
      disabled={busy}
      title="Check each claim against its cited source text"
      className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.04em] text-fg-3 transition-colors hover:border-border-hover hover:text-fg-2 disabled:opacity-50"
    >
      {busy ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" />}
      {busy ? "Verifying…" : verifiedAt ? "Re-verify" : "Verify sources"}
    </button>
  );
}

// ── Feedback bar (Phase 6) ──────────────────────────────────────

const REASON_LABELS: Record<AskFeedbackReason, string> = {
  wrong_sources: "Wrong sources",
  missed_source: "Missed a source",
  too_long: "Too long",
  tone: "Tone off",
  outdated: "Outdated",
  hallucination: "Made something up",
};

export function FeedbackBar({
  messageId,
  sessionId,
  query,
}: {
  messageId?: string;
  sessionId?: string | null;
  query: string;
}) {
  const [state, setState] = useState<"idle" | "reasons" | "done">("idle");
  const [reasons, setReasons] = useState<AskFeedbackReason[]>([]);
  const [comment, setComment] = useState("");
  if (!messageId) return null;

  async function send(rating: "up" | "down", withDetail: boolean) {
    try {
      await fetch("/api/ask/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messageId,
          sessionId: sessionId ?? undefined,
          rating,
          reasons: withDetail ? reasons : [],
          comment: withDetail ? comment : undefined,
          query,
        }),
      });
      setState("done");
    } catch {
      toast.error("Couldn't record feedback");
    }
  }

  if (state === "done") {
    return (
      <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.04em] text-fg-3">
        <Check className="h-3 w-3 text-[var(--green)]" />
        Feedback recorded
      </span>
    );
  }

  if (state === "reasons") {
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-border bg-bg px-3 py-2">
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(REASON_LABELS) as AskFeedbackReason[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() =>
                setReasons((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]))
              }
              className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                reasons.includes(r)
                  ? "border-border-accent bg-accent-bg text-accent-text"
                  : "border-border bg-surface text-fg-3 hover:text-fg-2"
              }`}
            >
              {REASON_LABELS[r]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="What went wrong? (optional)"
            className="w-full rounded-lg border border-border bg-surface px-2 py-1 text-[12px] text-fg outline-none placeholder:text-fg-3"
          />
          <button
            onClick={() => void send("down", true)}
            className="flex-shrink-0 rounded-lg bg-accent px-3 py-1 font-mono text-[10px] uppercase tracking-[0.04em] text-white hover:bg-accent-2"
          >
            Send
          </button>
        </div>
      </div>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button
        onClick={() => void send("up", false)}
        title="Good answer"
        className="rounded p-1 text-fg-3 transition-colors hover:bg-hover hover:text-[var(--green)]"
      >
        <ThumbsUp className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={() => setState("reasons")}
        title="Something's off"
        className="rounded p-1 text-fg-3 transition-colors hover:bg-hover hover:text-red"
      >
        <ThumbsDown className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}
