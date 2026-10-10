"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { ArrowRight, CalendarDays, Radar, ShieldCheck } from "lucide-react";
import { useDeadlines } from "@/hooks/use-deadlines";
import { useSignals } from "@/hooks/use-signals";
import { ReviewQueue } from "@/components/dashboard/review-queue";
import { SidePanel } from "@/components/shared/side-panel";
import { formatDate, relativeTime } from "@/lib/utils";
import type { Signal } from "@/lib/types";

const fetcher = (url: string) => fetch(url).then((r) => { if (!r.ok) throw new Error("Unable to load"); return r.json(); });
interface Queue { total: number; stale: { entryId: string; entryShortName: string; reason: string }[]; proposed: { changeId: string; entryId: string; entryShortName: string; changeSummary: string | null }[] }
interface Health { groundedEntries: number; sourceDocs: number; lastDigestDeliveredAt: string | null; lastAgentRunAt: string | null }

export default function DashboardPage() {
  const { data: dates, isLoading: datesLoading, error: datesError } = useDeadlines();
  const { data: signals, error: signalsError, isLoading: signalsLoading } = useSignals({ status: "active" });
  const { data: queue, error: queueError } = useSWR<Queue>("/api/review-queue", fetcher);
  const { data: health } = useSWR<Health>("/api/system-health", fetcher);
  const [signal, setSignal] = useState<Signal | null>(null);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const upcoming = [...(dates?.deadlines ?? [])].filter(d => d.date >= today).sort((a,b) => a.date.localeCompare(b.date)).slice(0, 4);
  const radar = [...(signals?.signals ?? [])].filter(s => (s.relevanceScore ?? 0) >= 50).sort((a,b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0)).slice(0, 3);
  const focus = queue?.stale?.[0];
  const proposal = queue?.proposed?.[0];
  const next = upcoming[0];
  const attentionTitle = focus?.entryShortName || proposal?.entryShortName || next?.entryShortName;
  const attentionBody = focus?.reason || proposal?.changeSummary || (proposal ? "A proposed change is waiting for your review." : next?.label);
  const attentionId = focus?.entryId || proposal?.entryId || next?.entryId;
  const attentionLabel = focus ? "Analysis needs a fresh look" : proposal ? "A change to review" : "Next on your horizon";
  return <div className="anim-enter">
    <header className="mb-10 flex items-center justify-between gap-8">
      <div><p className="page-kicker mb-3">Your workspace · APJ</p><h1 className="page-title">A clearer view of what’s next.</h1><p className="mt-3 text-[16px] text-fg-3">The decisions, dates and evidence that deserve your attention.</p></div>
      <Link href="/ask" className="argus-primary shrink-0">Ask Argus <ArrowRight size={16} /></Link>
    </header>
    <div className="grid items-start gap-7 xl:grid-cols-[minmax(0,1.5fr)_minmax(300px,1fr)]">
      <section className="min-w-0">
        <div className="mb-4 flex items-center justify-between"><h2 className="text-[19px] font-medium">In focus</h2><span className="text-[13px] text-fg-3">{queue ? `${queue.total} pending reviews` : queueError ? "Review count unavailable" : "Checking reviews…"}</span></div>
        <div className="quiet-card relative overflow-hidden p-7 xl:p-9" style={{ background: "linear-gradient(135deg, var(--bg-hover), var(--bg-surface))" }}>
          <p className="page-kicker mb-6 text-accent-text">{attentionTitle ? attentionLabel : "Your tracker"}</p>
          <h3 className="max-w-xl text-[27px] font-medium leading-[1.25] tracking-[-.03em]">{attentionTitle || (datesLoading ? "Bringing your workspace into focus…" : "Room to think ahead.")}</h3>
          <p className="mt-4 max-w-xl text-[16px] leading-[1.7] text-fg-2">{attentionBody || "Review your tracked instruments, inspect their sources, or ask Argus a question grounded in your records."}</p>
          <div className="mt-7 flex items-center justify-between gap-4 border-t border-border pt-6"><Link href={attentionId ? `/tracker/${attentionId}` : "/tracker"} className="argus-primary">{focus || proposal ? "Review record" : "Open tracker record"}<ArrowRight size={16} /></Link>{!focus && !proposal && next && <span className="text-right text-[13px] text-fg-3">Next date<br /><strong className="font-medium text-fg">{formatDate(next.date)}</strong></span>}</div>
        </div>
        <div className="mt-5"><ReviewQueue /></div>
      </section>
      <section className="min-w-0"><div className="mb-4 flex items-center justify-between"><h2 className="text-[19px] font-medium">On the horizon</h2><Link href="/tracker?lifecycle=upcoming" className="text-[13px] text-accent-text">View all →</Link></div>
        <div className="quiet-card divide-y divide-border px-6">
          {upcoming.map(d => <Link key={d.id} href={`/tracker/${d.entryId}`} className="group flex items-start gap-4 py-6"><span className="flex w-12 shrink-0 flex-col items-center rounded-xl bg-accent-bg py-2 text-accent-text"><span className="text-[10px] uppercase">{new Date(`${d.date}T12:00:00`).toLocaleDateString("en-AU", { month: "short" })}</span><span className="text-[24px] leading-tight">{d.date.slice(-2)}</span></span><span className="min-w-0"><span className="block text-[15px] leading-snug text-fg group-hover:text-accent-text">{d.entryShortName}</span><span className="mt-2 block text-[13px] leading-relaxed text-fg-3">{d.entryJurisdiction} · {d.label}</span></span></Link>)}
          {!upcoming.length && <div className="py-8 text-[15px] text-fg-3"><CalendarDays className="mb-3 h-5 w-5" />{datesError ? "Dates could not be loaded. Try refreshing." : datesLoading ? "Loading dates…" : "No upcoming dates recorded."}</div>}
        </div>
      </section>
    </div>
    <section className="mt-8"><div className="mb-4 flex items-center gap-2"><Radar size={18} className="text-accent-text" /><h2 className="text-[19px] font-medium">On your radar</h2><span className="ml-auto text-[13px] text-fg-3">Open a signal for the full context</span></div>
      <div className="quiet-card divide-y divide-border px-6">{radar.map(s => <button key={s.id} onClick={() => setSignal(s)} className="group flex w-full items-center gap-5 py-6 text-left"><span className="h-2 w-2 shrink-0 rounded-full bg-accent" /><span className="min-w-0 flex-1"><span className="block text-[17px] font-medium leading-snug group-hover:text-accent-text">{s.title}</span><span className="mt-2 block line-clamp-1 text-[14px] text-fg-3">{s.relevanceRationale || s.summary}</span></span><ArrowRight size={18} className="shrink-0 text-fg-3" /></button>)}{!radar.length && <p className="py-6 text-[15px] text-fg-3">{signalsError ? "Signals could not be loaded. Try refreshing." : signalsLoading ? "Loading signals…" : "No priority signals available."}</p>}</div>
    </section>
    {health && <footer className="mt-8 flex flex-wrap items-center gap-x-7 gap-y-3 border-t border-border pt-6 text-[13px] text-fg-3"><span className="inline-flex items-center gap-2"><ShieldCheck size={16} />{health.groundedEntries} grounded records</span><span>{health.sourceDocs} sources held</span><span className="ml-auto">Last agent run: {health.lastAgentRunAt ? relativeTime(health.lastAgentRunAt) : "not recorded"}</span><Link href="/automations" className="text-accent-text">View automations →</Link></footer>}
    <SidePanel open={!!signal} onClose={() => setSignal(null)} title="Signal, in context" description={signal?.updatedAt ? `Updated ${formatDate(signal.updatedAt)}` : undefined}>{signal && <><span className="page-kicker">Radar · Relevance {signal.relevanceScore ?? "unscored"}</span><h2 className="mt-4 text-[28px] leading-tight tracking-[-.025em]">{signal.title}</h2>{signal.relevanceRationale && <div className="my-6 rounded-2xl bg-accent-bg p-5"><h3 className="mb-2 text-[14px] font-semibold text-accent-text">Why this matters</h3><p className="text-[16px] leading-relaxed">{signal.relevanceRationale}</p></div>}<p className="whitespace-pre-wrap text-[16px] leading-[1.8] text-fg-2">{signal.summary}</p>{signal.link && <Link href={signal.link} className="argus-primary mt-7">{signal.linkLabel || "View records"}<ArrowRight size={16} /></Link>}</>}</SidePanel>
  </div>;
}
