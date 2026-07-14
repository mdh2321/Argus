"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import {
  Check,
  ChevronDown,
  ExternalLink,
  Loader2,
  ShieldCheck,
  ShieldQuestion,
  X,
} from "lucide-react";
import { SOURCE_TIERS } from "@/lib/constants";

// Intake panel — the single review gate of the intake redesign. While the
// background pipeline runs (resolve → verify → analyze) it renders a live
// timeline; afterwards it shows the provenance trail (attached with evidence,
// rejected with reasons) and holds ambiguous candidates for the human's call.

interface IntakeCandidate {
  id: string;
  url: string;
  title: string | null;
  snippet: string | null;
  tier: string | null;
  origin: "capture" | "search";
  verdict: "verified" | "rejected" | "uncertain" | null;
  evidence: string | null;
  suggestedRole: string | null;
  status: "attached" | "held" | "dismissed";
  decidedBy: "ai" | "human" | null;
  documentId: string | null;
}

interface IntakeState {
  intakeStatus: "resolving" | "verifying" | "done" | "failed" | null;
  intakeError: string | null;
  intakeStartedAt: string | null;
  summaryStatus: string;
  summaryDepth: string | null;
  candidates: IntakeCandidate[];
}

interface Props {
  entryId: string;
  /** Called when the panel changed the entry (docs attached, analysis kicked). */
  onChanged: () => void;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function IntakePanel({ entryId, onChanged }: Props) {
  const { data, mutate } = useSWR<IntakeState>(
    entryId ? `/api/tracker/entries/${entryId}/intake` : null,
    fetcher,
    {
      refreshInterval: (latest) =>
        latest &&
        (latest.intakeStatus === "resolving" ||
          latest.intakeStatus === "verifying" ||
          latest.summaryStatus === "running")
          ? 4000
          : 0,
    }
  );

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitAction, setSubmitAction] = useState<"add" | "analyze" | "dismiss" | null>(null);
  const seededRef = useRef(false);

  const held = useMemo(
    () => (data?.candidates ?? []).filter((c) => c.status === "held"),
    [data?.candidates]
  );
  const attached = useMemo(
    () => (data?.candidates ?? []).filter((c) => c.status === "attached"),
    [data?.candidates]
  );
  const rejected = useMemo(
    () => (data?.candidates ?? []).filter((c) => c.status === "dismissed"),
    [data?.candidates]
  );

  // Pre-select held candidates the match check verified (official material at
  // an unofficial tier, etc.) once the pipeline settles — the human's ticks
  // start from the machine's best guess.
  const intakeStatus = data?.intakeStatus ?? null;
  useEffect(() => {
    if (seededRef.current) return;
    if (intakeStatus !== "done" && intakeStatus !== "failed") return;
    if (!held.length) return;
    seededRef.current = true;
    setSelected(new Set(held.filter((c) => c.verdict === "verified").map((c) => c.id)));
  }, [intakeStatus, held]);

  // Refresh the surrounding page when the pipeline finishes or attaches docs.
  const prevRef = useRef<{ status: string | null; attached: number }>({ status: null, attached: 0 });
  useEffect(() => {
    if (!data) return;
    const prev = prevRef.current;
    if (
      (prev.status !== data.intakeStatus && (data.intakeStatus === "done" || data.intakeStatus === "failed")) ||
      prev.attached !== attached.length
    ) {
      onChanged();
    }
    prevRef.current = { status: data.intakeStatus, attached: attached.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.intakeStatus, attached.length]);

  if (!data || (!data.intakeStatus && data.candidates.length === 0)) return null;

  const running = data.intakeStatus === "resolving" || data.intakeStatus === "verifying";
  const analyzing = data.summaryStatus === "running";
  const submitting = submitAction !== null;

  async function act(action: "approve" | "dismiss", thenAnalyze: boolean) {
    if (selected.size === 0) return;
    setSubmitAction(action === "dismiss" ? "dismiss" : thenAnalyze ? "analyze" : "add");
    try {
      const res = await fetch(`/api/tracker/entries/${entryId}/intake`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateIds: Array.from(selected), action, thenAnalyze }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Action failed");
      if (action === "approve") {
        toast.success(
          json.analyzing
            ? `Added ${json.approved} source${json.approved === 1 ? "" : "s"} — full analysis started`
            : `Added ${json.approved} source${json.approved === 1 ? "" : "s"}`
        );
      }
      setSelected(new Set());
      await mutate();
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    } finally {
      setSubmitAction(null);
    }
  }

  // Quiet provenance summary once everything is settled and nothing needs the
  // human — collapsed by default so reviewed entries stay clean.
  const settled = !running && !analyzing && held.length === 0 && data.intakeStatus !== "failed";

  return (
    <div className="mb-4 rounded-xl border border-border bg-surface">
      {settled ? (
        <details>
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-[12px] text-fg-3 hover:text-fg-2 [&::-webkit-details-marker]:hidden">
            <ShieldCheck className="h-3.5 w-3.5 text-accent" />
            <span className="font-mono">
              Intake: {attached.length} source{attached.length === 1 ? "" : "s"} attached
              {rejected.length > 0 ? `, ${rejected.length} rejected` : ""}
            </span>
            <ChevronDown className="ml-auto h-3.5 w-3.5" />
          </summary>
          <div className="border-t border-border/60 px-4 py-3">
            <ProvenanceLists attached={attached} rejected={rejected} />
          </div>
        </details>
      ) : (
        <div className="p-4">
          <IntakeTimeline
            intakeStatus={data.intakeStatus}
            analyzing={analyzing}
            summaryDepth={data.summaryDepth}
            attachedCount={attached.length}
            checkedCount={attached.length + rejected.length + held.filter((c) => c.verdict !== null).length}
          />

          {data.intakeStatus === "failed" && (
            <div className="mt-3 rounded-lg border border-red/30 bg-red-bg p-3 text-[12px] text-fg-2">
              Intake failed: {data.intakeError ?? "unknown error"}
            </div>
          )}

          {(attached.length > 0 || rejected.length > 0) && (
            <div className="mt-3">
              <ProvenanceLists attached={attached} rejected={rejected} />
            </div>
          )}

          {!running && held.length > 0 && (
            <div className="mt-3 border-t border-border/60 pt-3">
              <div className="mb-2 flex items-center gap-2">
                <ShieldQuestion className="h-3.5 w-3.5 text-amber" />
                <span className="text-[12px] font-semibold text-fg">Your call</span>
                <span className="font-mono text-[11px] text-fg-3">
                  {`${held.length} candidate${held.length === 1 ? "" : "s"} Argus didn't attach automatically`}
                </span>
              </div>
              <ul className="divide-y divide-border/60">
                {held.map((c) => (
                  <li key={c.id} className="py-2">
                    <label className="flex cursor-pointer items-start gap-3">
                      <input
                        type="checkbox"
                        checked={selected.has(c.id)}
                        onChange={() =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (next.has(c.id)) next.delete(c.id);
                            else next.add(c.id);
                            return next;
                          })
                        }
                        className="mt-1 h-4 w-4 cursor-pointer accent-accent"
                      />
                      <CandidateRow candidate={c} />
                    </label>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
                <button
                  onClick={() => act("dismiss", false)}
                  disabled={selected.size === 0 || submitting}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg px-3 py-1.5 font-mono text-[11px] text-fg-2 transition-colors hover:bg-bg-hover disabled:opacity-50"
                >
                  {submitAction === "dismiss" ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                  Dismiss
                </button>
                <button
                  onClick={() => act("approve", false)}
                  disabled={selected.size === 0 || submitting}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg px-3 py-1.5 font-mono text-[11px] font-medium text-fg-2 transition-colors hover:bg-bg-hover disabled:opacity-50"
                >
                  {submitAction === "add" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                  Add {selected.size || ""}
                </button>
                <button
                  onClick={() => act("approve", true)}
                  disabled={selected.size === 0 || submitting}
                  className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 font-mono text-[11px] font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {submitAction === "analyze" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                  Add &amp; analyze
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function IntakeTimeline({
  intakeStatus,
  analyzing,
  summaryDepth,
  attachedCount,
  checkedCount,
}: {
  intakeStatus: IntakeState["intakeStatus"];
  analyzing: boolean;
  summaryDepth: string | null;
  attachedCount: number;
  checkedCount: number;
}) {
  const steps: { label: string; state: "done" | "active" | "pending" }[] = [
    { label: "Captured", state: "done" },
    {
      label: "Finding sources",
      state: intakeStatus === "resolving" ? "active" : "done",
    },
    {
      label:
        checkedCount > 0
          ? `Verifying (${attachedCount} attached / ${checkedCount} checked)`
          : "Verifying",
      state:
        intakeStatus === "verifying"
          ? "active"
          : intakeStatus === "resolving"
            ? "pending"
            : "done",
    },
    {
      label: analyzing
        ? "Analyzing"
        : summaryDepth === "full"
          ? "Grounded analysis"
          : summaryDepth === "preliminary"
            ? "Preliminary analysis"
            : "Analysis",
      state: analyzing
        ? "active"
        : intakeStatus === "done" || intakeStatus === "failed"
          ? summaryDepth
            ? "done"
            : "pending"
          : "pending",
    },
  ];

  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
      {steps.map((s, i) => (
        <div key={s.label} className="flex items-center gap-1.5">
          {i > 0 && <span className="h-px w-4 bg-border" />}
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 font-mono text-[11px] leading-none ${
              s.state === "active"
                ? "bg-accent/10 text-accent"
                : s.state === "done"
                  ? "text-fg-2"
                  : "text-fg-3 opacity-60"
            }`}
          >
            {s.state === "active" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : s.state === "done" ? (
              <Check className="h-3 w-3 text-accent" />
            ) : (
              <span className="h-3 w-3 rounded-full border border-border" />
            )}
            {s.label}
          </span>
        </div>
      ))}
    </div>
  );
}

function ProvenanceLists({
  attached,
  rejected,
}: {
  attached: IntakeCandidate[];
  rejected: IntakeCandidate[];
}) {
  return (
    <div className="space-y-2">
      {attached.length > 0 && (
        <ul className="space-y-1.5">
          {attached.map((c) => (
            <li key={c.id} className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-accent" />
              <CandidateRow candidate={c} compact />
            </li>
          ))}
        </ul>
      )}
      {rejected.length > 0 && (
        <details>
          <summary className="cursor-pointer list-none font-mono text-[11px] text-fg-3 hover:text-fg-2 [&::-webkit-details-marker]:hidden">
            {rejected.length} candidate{rejected.length === 1 ? "" : "s"} rejected — show why
          </summary>
          <ul className="mt-1.5 space-y-1.5">
            {rejected.map((c) => (
              <li key={c.id} className="flex items-start gap-2 opacity-70">
                <X className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-red" />
                <CandidateRow candidate={c} compact />
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function CandidateRow({ candidate: c, compact }: { candidate: IntakeCandidate; compact?: boolean }) {
  const tierConfig = SOURCE_TIERS.find((t) => t.value === c.tier);
  const hostname = hostnameOf(c.url);
  return (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        <a
          href={c.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex max-w-full items-center gap-1 truncate text-[12.5px] font-medium text-fg hover:text-accent"
        >
          <span className="truncate">{c.title || hostname}</span>
          <ExternalLink className="h-3 w-3 flex-shrink-0 text-fg-3" />
        </a>
        <span className="font-mono text-[10.5px] text-fg-3">{hostname}</span>
        {tierConfig && (
          <span
            className="rounded px-1.5 py-0.5 font-mono text-[10px] font-medium leading-none"
            style={{
              color: tierConfig.color,
              background: `${tierConfig.color}15`,
              border: `1px solid ${tierConfig.color}30`,
            }}
          >
            {tierConfig.label}
          </span>
        )}
        {c.suggestedRole === "primary_text" && (
          <span className="rounded bg-accent/10 px-1.5 py-0.5 font-mono text-[10px] font-medium leading-none text-accent">
            instrument text
          </span>
        )}
      </div>
      {c.evidence ? (
        <p className="mt-0.5 text-[11.5px] leading-snug text-fg-3">{c.evidence}</p>
      ) : (
        !compact && c.snippet && (
          <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-fg-3">{c.snippet}</p>
        )
      )}
    </div>
  );
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
