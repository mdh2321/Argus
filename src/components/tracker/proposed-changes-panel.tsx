"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, X, ExternalLink, GitPullRequest } from "lucide-react";
import type { EntryChange, KeyDate } from "@/lib/types";
import { relativeTime } from "@/lib/utils";

// A1 — surfaces AI-proposed changes to this entry (from digest→entry
// reconciliation) as a pending decision the reader can approve or dismiss
// inline. Approving applies the change and folds it into the entry's history;
// dismissing leaves the entry untouched.

const FIELD_LABELS: Record<string, string> = {
  status: "Status",
  key_dates: "Key dates",
  regulator: "Regulator",
  penalties: "Penalties",
};

function formatValue(field: string, value: string | null): string {
  if (!value) return "—";
  if (field === "key_dates") {
    try {
      const dates = JSON.parse(value) as KeyDate[];
      if (!Array.isArray(dates) || dates.length === 0) return "(no dates)";
      return dates.map((d) => `${d.date}${d.label ? ` — ${d.label}` : ""}`).join("\n");
    } catch {
      return value;
    }
  }
  return value;
}

export function ProposedChangesPanel({
  proposals,
  onResolved,
}: {
  proposals: EntryChange[];
  onResolved: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);

  if (!proposals || proposals.length === 0) return null;

  const act = async (id: string, action: "approve" | "dismiss") => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/tracker/changes/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      toast.success(action === "approve" ? "Change applied to entry" : "Proposal dismissed");
      onResolved();
    } catch (err) {
      toast.error(`Couldn't ${action} change`, {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="rounded-xl border border-[color:var(--amber)]/30 bg-[var(--amber-bg)] px-4 py-3">
      <div className="flex items-start gap-3">
        <GitPullRequest className="h-4 w-4 text-[var(--amber)] mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium text-fg">
            {proposals.length} proposed {proposals.length === 1 ? "change" : "changes"} from the digest
          </div>
          <p className="mt-0.5 text-[12px] text-fg-2 leading-relaxed">
            A recent story implied these updates. Nothing is applied until you approve it.
          </p>

          <div className="mt-3 space-y-2.5">
            {proposals.map((c) => (
              <div
                key={c.id}
                className="rounded-lg border border-border/70 bg-surface px-3 py-2.5"
              >
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <span className="text-[12px] font-medium text-fg">
                    {FIELD_LABELS[c.fieldChanged] ?? c.fieldChanged}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={busyId === c.id}
                      onClick={() => act(c.id, "approve")}
                      className="inline-flex items-center gap-1 rounded-md bg-accent text-white px-2 py-0.5 text-[11px] font-mono font-medium hover:bg-accent-2 transition-colors disabled:opacity-50"
                    >
                      <Check className="w-3 h-3" /> Approve
                    </button>
                    <button
                      type="button"
                      disabled={busyId === c.id}
                      onClick={() => act(c.id, "dismiss")}
                      className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[11px] font-mono text-fg-2 hover:bg-hover transition-colors disabled:opacity-50"
                    >
                      <X className="w-3 h-3" /> Dismiss
                    </button>
                  </div>
                </div>

                <div className="grid gap-2 mt-2 sm:grid-cols-2">
                  <ValueCell label="Current" value={formatValue(c.fieldChanged, c.oldValue)} tone="old" />
                  <ValueCell label="Proposed" value={formatValue(c.fieldChanged, c.newValue)} tone="new" />
                </div>

                {c.changeSummary && (
                  <p className="mt-2 text-[11px] text-fg-3 leading-relaxed">{c.changeSummary}</p>
                )}
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-fg-3">
                  <span className="tabular-nums">{relativeTime(c.changedAt)}</span>
                  {c.sourceUrl && (
                    <a
                      href={c.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-0.5 hover:text-accent"
                    >
                      source <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ValueCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "old" | "new";
}) {
  return (
    <div
      className={`rounded-md border px-2.5 py-1.5 ${
        tone === "new" ? "border-accent/30 bg-accent/5" : "border-border bg-hover/40"
      }`}
    >
      <div className="text-[10px] uppercase tracking-wide text-fg-3 mb-0.5">{label}</div>
      <div className="text-[12px] text-fg-2 whitespace-pre-line break-words">{value}</div>
    </div>
  );
}
