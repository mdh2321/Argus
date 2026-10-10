"use client";

import useSWR from "swr";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Activity, Loader2 } from "lucide-react";
import { workflowLabel } from "@/lib/agent-workflows";
import { relativeTime } from "@/lib/utils";

// E1 — header activity + cost indicator. Polls /api/activity: shows a "running"
// pill while analyses are in flight, fires a toast on completion, and opens a
// popover with this month's AI spend and the recent runs.

interface RunRow {
  id: string;
  runAt: string;
  workflow: string | null;
  modelUsed: string | null;
  costEstimate: number | null;
  entriesCreated: number | null;
  entriesUpdated: number | null;
}
interface ActivityResponse {
  thisMonth: string;
  thisMonthSpend: number;
  monthly: { month: string; total: number; runs: number }[];
  recent: RunRow[];
  inFlight: { id: string; shortName: string }[];
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function fmtUsd(n: number | null | undefined): string {
  const v = n ?? 0;
  if (v === 0) return "$0";
  if (v < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
}

export function ActivityPopover() {
  const { data } = useSWR<ActivityResponse>("/api/activity", fetcher, {
    refreshInterval: 15_000,
  });
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const prevInFlight = useRef<number | null>(null);

  const inFlight = data?.inFlight.length ?? 0;

  // Completion toast — when the in-flight count falls to zero, something that
  // was running just finished.
  useEffect(() => {
    if (prevInFlight.current !== null && prevInFlight.current > 0 && inFlight === 0) {
      toast.success("Analysis complete");
    }
    prevInFlight.current = inFlight;
  }, [inFlight]);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg px-2.5 text-fg-3 hover:text-fg-2 hover:bg-hover transition-all duration-150"
        aria-label="Activity and cost"
        aria-expanded={open}
        aria-controls="activity-popover-content"
        title="Activity & AI spend"
      >
        {inFlight > 0 ? (
          <span className="inline-flex items-center gap-1.5 text-accent">
            <Loader2 className="w-[15px] h-[15px] animate-spin" strokeWidth={1.5} />
            <span className="font-mono text-[10px]">{inFlight} running</span>
          </span>
        ) : (
          <Activity className="w-[15px] h-[15px]" strokeWidth={1.5} />
        )}
      </button>

      {open && (
        <div id="activity-popover-content" className="absolute right-0 mt-2 w-80 rounded-xl border border-border bg-surface shadow-[var(--shadow-l)] z-[90] overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <div className="flex items-baseline justify-between">
              <span className="text-[14px] font-medium text-fg-3">
                Spend · {data?.thisMonth ?? "—"}
              </span>
              <span className="text-[15px] font-semibold text-fg tabular-nums">
                {fmtUsd(data?.thisMonthSpend)}
              </span>
            </div>
          </div>

          {inFlight > 0 && (
            <div className="px-4 py-2.5 border-b border-border bg-accent/5">
              {data?.inFlight.map((e) => (
                <div key={e.id} className="flex items-center gap-2 text-[14px] text-fg-2">
                  <Loader2 className="w-3 h-3 animate-spin text-accent" />
                  <span className="truncate">Analyzing {e.shortName}</span>
                </div>
              ))}
            </div>
          )}

          <div className="max-h-72 overflow-y-auto">
            <div className="px-4 py-2 text-[14px] font-medium text-fg-3">
              Recent runs
            </div>
            {data && data.recent.length > 0 ? (
              data.recent.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center gap-3 px-4 py-2 border-t border-border/50 first:border-t-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-medium text-fg truncate">
                      {workflowLabel(r.workflow)}
                    </div>
                    <div className="text-[13px] text-fg-3 tabular-nums">{relativeTime(r.runAt)}</div>
                  </div>
                  <span className="text-[13px] text-fg-3 tabular-nums flex-shrink-0">
                    {fmtUsd(r.costEstimate)}
                  </span>
                </div>
              ))
            ) : (
              <div className="px-4 py-4 text-center text-[14px] text-fg-3">No runs yet.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
