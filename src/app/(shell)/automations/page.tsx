"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";
import { workflowLabel } from "@/lib/agent-workflows";
import { relativeTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Radar,
  Search,
  BookOpen,
  Lightbulb,
  Play,
  Loader2,
  Clock,
  Cpu,
  type LucideIcon,
} from "lucide-react";

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

// The background agents that run on their own. Some can be triggered on demand;
// the weekly digest and landscape scan are driven elsewhere (a schedule / the
// tracker), so they link out rather than run in place.
interface AgentDef {
  workflow: string;
  label: string;
  desc: string;
  icon: LucideIcon;
  color: string;
  trigger?: string; // POST endpoint for "run now"
  link?: { href: string; label: string };
}

const AGENTS: AgentDef[] = [
  {
    workflow: "signals",
    label: "Radar signals",
    desc: "Scans the web for developments relevant to your company profile and scores them.",
    icon: Radar,
    color: "var(--amber)",
    trigger: "/api/signals/generate",
  },
  {
    workflow: "gap",
    label: "Gap suggestions",
    desc: "Reads the latest digest and surfaces regulations worth adding to the tracker.",
    icon: Lightbulb,
    color: "var(--cyan)",
    trigger: "/api/digest/gap-suggestions/generate",
  },
  {
    workflow: "scan",
    label: "Landscape scan",
    desc: "Sweeps a jurisdiction for instruments you're not yet tracking.",
    icon: Search,
    color: "var(--green)",
    link: { href: "/tracker", label: "Scan from Tracker" },
  },
  {
    workflow: "reconcile",
    label: "Weekly digest",
    desc: "Assembles and delivers the weekly intelligence digest. Runs on a schedule.",
    icon: BookOpen,
    color: "var(--purple)",
    link: { href: "/digest", label: "Open Digest" },
  },
];

export default function AutomationsPage() {
  const { data, isLoading } = useSWR<ActivityResponse>("/api/activity", fetcher, {
    refreshInterval: 15_000,
  });
  const { mutate } = useSWRConfig();
  const [running, setRunning] = useState<string | null>(null);

  const recent = data?.recent ?? [];
  const lastRunFor = (workflow: string) => recent.find((r) => r.workflow === workflow);

  async function runNow(agent: AgentDef) {
    if (!agent.trigger || running) return;
    setRunning(agent.workflow);
    try {
      const res = await fetch(agent.trigger, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success(`${agent.label} started`);
      mutate("/api/activity");
    } catch (err) {
      toast.error(`Couldn't start ${agent.label}`, {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRunning(null);
    }
  }

  const maxMonthly = Math.max(0.0001, ...(data?.monthly ?? []).map((m) => m.total));

  return (
    <div className="anim-enter mx-auto max-w-3xl">
      {/* Header */}
      <div className="mb-8 flex items-end justify-between gap-4">
        <div className="relative grid-pattern py-4">
          <div className="relative z-10 flex items-center gap-2.5">
            <Cpu className="h-5 w-5" style={{ color: "var(--accent)" }} />
            <h1 className="text-gradient text-[28px] font-bold tracking-[-0.02em]">Automations</h1>
          </div>
          <p className="relative z-10 mt-1.5 text-[14px] text-fg-3">
            The agents working in the background — what they do, when they last ran, and what they cost.
          </p>
        </div>
        <div className="flex-shrink-0 rounded-xl bg-surface px-4 py-3 text-right shadow-[var(--shadow-card)]">
          <div className="label-mono">Spend · {data?.thisMonth ?? "—"}</div>
          <div className="mt-0.5 text-[20px] font-semibold text-fg tabular-nums">{fmtUsd(data?.thisMonthSpend)}</div>
        </div>
      </div>

      {/* Agents */}
      <div className="mb-10 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {AGENTS.map((agent) => {
          const last = lastRunFor(agent.workflow);
          const Icon = agent.icon;
          const isRunning = running === agent.workflow;
          const outcome = last
            ? [
                (last.entriesCreated ?? 0) > 0 ? `${last.entriesCreated} added` : null,
                (last.entriesUpdated ?? 0) > 0 ? `${last.entriesUpdated} updated` : null,
              ]
                .filter(Boolean)
                .join(" · ")
            : "";
          return (
            <div key={agent.workflow} className="flex flex-col rounded-xl bg-surface p-4 shadow-[var(--shadow-card)]">
              <div className="flex items-start gap-3">
                <span
                  className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl"
                  style={{ background: `color-mix(in srgb, ${agent.color} 12%, transparent)` }}
                >
                  <Icon className="h-4.5 w-4.5" style={{ color: agent.color }} />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-[15px] font-semibold text-fg">{agent.label}</h3>
                  <p className="mt-0.5 text-[12.5px] leading-relaxed text-fg-3">{agent.desc}</p>
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
                <span className="flex items-center gap-1.5 font-mono text-[11px] text-fg-3">
                  <Clock className="h-3 w-3" />
                  {last ? (
                    <>
                      {relativeTime(last.runAt)}
                      {outcome && <span className="text-fg-2">· {outcome}</span>}
                    </>
                  ) : (
                    "No recent runs"
                  )}
                </span>
                {agent.trigger ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => runNow(agent)}
                    disabled={!!running}
                    title={`Run ${agent.label} now`}
                  >
                    {isRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                    {isRunning ? "Running" : "Run now"}
                  </Button>
                ) : agent.link ? (
                  <Link
                    href={agent.link.href}
                    className="font-mono text-[11px] uppercase tracking-[0.04em] text-accent-text transition-colors hover:text-accent"
                  >
                    {agent.link.label} →
                  </Link>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {/* Monthly spend */}
      {data && data.monthly.length > 0 && (
        <section className="mb-10">
          <h2 className="label-mono mb-3">Spend by month</h2>
          <div className="flex items-end gap-3 rounded-xl bg-surface p-4 shadow-[var(--shadow-card)]" style={{ height: 116 }}>
            {data.monthly.map((m) => (
              <div key={m.month} className="flex flex-1 flex-col items-center gap-1" title={`${fmtUsd(m.total)} · ${m.runs} runs`}>
                <span className="font-mono text-[9px] text-fg-3 tabular-nums">{fmtUsd(m.total)}</span>
                <div className="flex w-full flex-1 items-end">
                  <div
                    className="w-full rounded-t bg-accent/70 transition-all"
                    style={{ height: `${Math.max(10, (m.total / maxMonthly) * 100)}%` }}
                  />
                </div>
                <span className="font-mono text-[9px] text-fg-3">{m.month.slice(5)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Recent runs */}
      <section>
        <h2 className="label-mono mb-3">Recent runs</h2>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-11 w-full rounded-lg" />
            ))}
          </div>
        ) : recent.length === 0 ? (
          <EmptyState icon={Cpu} title="No runs yet" description="Agent activity will appear here once the background workflows have run." />
        ) : (
          <div className="overflow-hidden rounded-xl bg-surface shadow-[var(--shadow-card)]">
            {recent.map((r) => {
              const outcome = [
                (r.entriesCreated ?? 0) > 0 ? `${r.entriesCreated} added` : null,
                (r.entriesUpdated ?? 0) > 0 ? `${r.entriesUpdated} updated` : null,
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <div key={r.id} className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-0">
                  <span className="w-40 flex-shrink-0 text-[13px] font-medium text-fg">{workflowLabel(r.workflow)}</span>
                  <span className="flex-shrink-0 font-mono text-[11px] text-fg-3 tabular-nums">{relativeTime(r.runAt)}</span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-fg-3">{outcome}</span>
                  {r.modelUsed && (
                    <span className="hidden flex-shrink-0 font-mono text-[10px] text-fg-3 sm:inline">{r.modelUsed}</span>
                  )}
                  <span className="w-16 flex-shrink-0 text-right font-mono text-[11px] text-fg-3 tabular-nums">
                    {fmtUsd(r.costEstimate)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
