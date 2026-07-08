"use client";

import useSWR from "swr";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowRight, Check, ChevronDown, X } from "lucide-react";

// B1 — the review strip. Collapsed it's a one-line count ("3 decisions
// waiting"); expanded it's a flat, actionable list: proposed changes get
// inline Approve/Dismiss (same PATCH contract as ProposedChangesPanel),
// stale analyses link to their entry where re-run lives. Renders nothing at
// all when the queue is empty — an empty queue shouldn't occupy the page.

interface ProposedItem {
  changeId: string;
  entryId: string;
  entryShortName: string;
  field: string;
  fieldLabel: string;
  oldValue: string | null;
  newValue: string | null;
  changeSummary: string | null;
}
interface StaleItem {
  entryId: string;
  entryShortName: string;
  reason: string;
}
interface ReviewQueueResponse {
  total: number;
  proposed: ProposedItem[];
  stale: StaleItem[];
  related: { preliminaryCount: number; gapCount: number };
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

// key_dates values are stored as JSON arrays; other fields are plain strings.
function shortValue(field: string, value: string | null): string {
  if (!value) return "—";
  if (field === "key_dates") {
    try {
      const dates = JSON.parse(value) as { date: string; label?: string }[];
      if (!Array.isArray(dates) || dates.length === 0) return "(no dates)";
      const last = dates[dates.length - 1];
      return `${last.label ?? "date"} · ${last.date}`;
    } catch {
      return value;
    }
  }
  return value.replaceAll("_", " ");
}

export function ReviewQueue() {
  const { data, mutate } = useSWR<ReviewQueueResponse>("/api/review-queue", fetcher, {
    refreshInterval: 60_000,
  });
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  if (!data || data.total === 0) return null;

  const parts: string[] = [];
  if (data.proposed.length > 0) {
    parts.push(`${data.proposed.length} proposed change${data.proposed.length === 1 ? "" : "s"}`);
  }
  if (data.stale.length > 0) {
    parts.push(`${data.stale.length} stale analys${data.stale.length === 1 ? "is" : "es"}`);
  }

  const act = async (changeId: string, action: "approve" | "dismiss") => {
    setBusyId(changeId);
    try {
      const res = await fetch(`/api/tracker/changes/${changeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      toast.success(action === "approve" ? "Change applied to entry" : "Proposal dismissed");
      await mutate();
    } catch (err) {
      toast.error(`Couldn't ${action} change`, {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusyId(null);
    }
  };

  const { preliminaryCount, gapCount } = data.related;

  return (
    <section className="mb-10 rounded-xl border border-border bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-bg-hover/40 rounded-xl"
      >
        <span className="rounded-full bg-accent/10 px-2 py-0.5 font-mono text-[11px] font-medium text-accent">
          {data.total}
        </span>
        <span className="text-[13px] text-fg-2">
          <span className="font-medium text-fg">
            decision{data.total === 1 ? "" : "s"} waiting
          </span>{" "}
          — {parts.join(", ")}
        </span>
        <span className="ml-auto flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.04em] text-accent-text">
          Review
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </span>
      </button>

      {open && (
        <div className="border-t border-border/60 px-4 pb-3 pt-1">
          {data.proposed.map((p) => (
            <div
              key={p.changeId}
              className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border/60 py-2.5 last:border-0"
            >
              <div className="min-w-0 flex-1">
                <Link
                  href={`/tracker/${p.entryId}`}
                  className="truncate text-[13px] font-medium text-fg hover:text-accent transition-colors block"
                >
                  {p.entryShortName}
                </Link>
                <span className="mt-0.5 block font-mono text-[11px] text-fg-3">
                  {p.fieldLabel}&nbsp;&nbsp;
                  <span className="line-through opacity-70">{shortValue(p.field, p.oldValue)}</span>
                  {" → "}
                  <span style={{ color: "var(--green-text)" }}>{shortValue(p.field, p.newValue)}</span>
                </span>
              </div>
              <div className="flex flex-shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  disabled={busyId === p.changeId}
                  onClick={() => act(p.changeId, "approve")}
                  className="inline-flex items-center gap-1 rounded-md bg-accent px-2 py-0.5 font-mono text-[11px] font-medium text-white transition-colors hover:bg-accent-2 disabled:opacity-50"
                >
                  <Check className="h-3 w-3" /> Approve
                </button>
                <button
                  type="button"
                  disabled={busyId === p.changeId}
                  onClick={() => act(p.changeId, "dismiss")}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 font-mono text-[11px] text-fg-2 transition-colors hover:bg-hover disabled:opacity-50"
                >
                  <X className="h-3 w-3" /> Dismiss
                </button>
              </div>
            </div>
          ))}

          {data.stale.map((s) => (
            <Link
              key={s.entryId}
              href={`/tracker/${s.entryId}`}
              className="group flex items-center gap-3 border-b border-border/60 py-2.5 last:border-0"
            >
              <div className="min-w-0 flex-1">
                <span className="truncate text-[13px] font-medium text-fg group-hover:text-accent transition-colors block">
                  {s.entryShortName}
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-fg-3">{s.reason}</span>
              </div>
              <span className="flex flex-shrink-0 items-center gap-1 font-mono text-[10px] uppercase tracking-[0.04em] text-fg-3 group-hover:text-accent">
                Re-run on entry <ArrowRight className="h-3 w-3" />
              </span>
            </Link>
          ))}

          {(preliminaryCount > 0 || gapCount > 0) && (
            <div className="pt-2.5 font-mono text-[10.5px] text-fg-3">
              Also:{" "}
              {preliminaryCount > 0 && (
                <Link
                  href="/tracker?depth=preliminary"
                  className="text-accent-text hover:text-accent transition-colors"
                >
                  {preliminaryCount} ungrounded entr{preliminaryCount === 1 ? "y" : "ies"} → Tracker
                </Link>
              )}
              {preliminaryCount > 0 && gapCount > 0 && " · "}
              {gapCount > 0 && (
                <Link
                  href="/digest"
                  className="text-accent-text hover:text-accent transition-colors"
                >
                  {gapCount} possible gap{gapCount === 1 ? "" : "s"} → Digest
                </Link>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
