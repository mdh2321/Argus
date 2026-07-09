"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useHorizon } from "@/hooks/use-horizon";
import { JURISDICTIONS, CATEGORIES, URGENCY } from "@/lib/constants";
import { StatusBadge } from "@/components/ui/status-badge";
import { ImpactIndicator } from "@/components/ui/impact-indicator";
import { CopyMarkdownButton } from "@/components/shared/copy-markdown-button";
import { HorizonHeatmap } from "@/components/tracker/horizon-heatmap";
import { formatDate, calculateUrgency } from "@/lib/utils";
import { DEADLINE_KIND_META, DEADLINE_KINDS } from "@/lib/deadline-kind";
import type { HorizonItem, DeadlineKind } from "@/lib/types";
import { Telescope, ChevronRight, Filter, PenLine } from "lucide-react";

type Range = "3" | "6" | "12" | "all";

// The flagship forward-looking view: "what's landing in the next 3/6/12
// months and why it matters", grouped by quarter. Built to be screen-shared
// unedited — outlook framing, not a compliance task list.
export default function HorizonPage() {
  const { data, isLoading } = useHorizon();
  const [range, setRange] = useState<Range>("12");
  const [jurisdiction, setJurisdiction] = useState<string>("all");
  const [category, setCategory] = useState<string>("all");
  const [kind, setKind] = useState<DeadlineKind | "all">("all");

  const filtered = useMemo(() => {
    const items = data?.items || [];
    const cutoff = new Date();
    if (range !== "all") cutoff.setMonth(cutoff.getMonth() + parseInt(range, 10));
    return items.filter((item) => {
      if (range !== "all" && new Date(item.date) > cutoff) return false;
      if (jurisdiction !== "all" && item.jurisdiction !== jurisdiction) return false;
      if (category !== "all" && item.category !== category) return false;
      if (kind !== "all" && item.kind !== kind) return false;
      return true;
    });
  }, [data?.items, range, jurisdiction, category, kind]);

  const quarters = useMemo(() => groupByQuarter(filtered), [filtered]);

  return (
    <div className="anim-enter">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="relative grid-pattern py-4">
          <div className="relative z-10 flex items-center gap-2.5">
            <Telescope className="h-5 w-5" style={{ color: "var(--accent)" }} />
            <h1 className="text-gradient text-[28px] font-bold tracking-[-0.02em]">
              Horizon
            </h1>
          </div>
          <p className="relative z-10 mt-1.5 max-w-xl text-[14px] text-fg-3">
            What&apos;s landing in the next 3, 6 and 12 months across APJ — and why it
            matters for us and for our customers.
          </p>
        </div>

        <CopyMarkdownButton
          label="Copy outlook"
          getMarkdown={() => horizonToMarkdown(quarters, range, jurisdiction, category)}
        />
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-surface p-4">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-hover px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.04em] text-fg-3">
          <Filter className="h-3 w-3" />
          Outlook
        </div>

        {([
          { value: "3", label: "3 months" },
          { value: "6", label: "6 months" },
          { value: "12", label: "12 months" },
          { value: "all", label: "All" },
        ] as { value: Range; label: string }[]).map((option) => (
          <button
            key={option.value}
            onClick={() => setRange(option.value)}
            className={`rounded-full px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.04em] transition-colors ${
              range === option.value ? "bg-accent text-white" : "bg-hover text-fg-2 hover:text-fg"
            }`}
          >
            {option.label}
          </button>
        ))}

        <div className="mx-1 h-5 w-px bg-border" />

        <button
          onClick={() => setJurisdiction("all")}
          className={`rounded-full px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.04em] transition-colors ${
            jurisdiction === "all" ? "bg-accent text-white" : "bg-hover text-fg-2 hover:text-fg"
          }`}
        >
          All
        </button>
        {JURISDICTIONS.map((j) => (
          <button
            key={j.code}
            onClick={() => setJurisdiction(jurisdiction === j.code ? "all" : j.code)}
            title={j.name}
            className={`rounded-full px-2.5 py-1.5 text-[13px] leading-none transition-colors ${
              jurisdiction === j.code ? "bg-accent" : "bg-hover hover:bg-border"
            }`}
          >
            {j.flag}
          </button>
        ))}

        <div className="mx-1 h-5 w-px bg-border" />

        {DEADLINE_KINDS.map((k) => {
          const meta = DEADLINE_KIND_META[k];
          const active = kind === k;
          return (
            <button
              key={k}
              onClick={() => setKind(active ? "all" : k)}
              title={meta.description}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.04em] transition-colors ${
                active ? "bg-accent text-white" : "bg-hover text-fg-2 hover:text-fg"
              }`}
            >
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ background: active ? "currentColor" : meta.color }}
              />
              {meta.label}
            </button>
          );
        })}

        <div className="mx-1 h-5 w-px bg-border" />

        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-full bg-hover px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.04em] text-fg-2 outline-none transition-colors hover:text-fg"
        >
          <option value="all">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {!isLoading && filtered.length > 0 && <HorizonHeatmap items={filtered} />}

      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      ) : quarters.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface px-6 py-16 text-center text-[14px] text-fg-3">
          Nothing on the horizon for this view. Widen the range or clear filters.
        </div>
      ) : (
        <div className="space-y-10">
          {quarters.map((quarter) => (
            <section key={quarter.key}>
              <div className="mb-3 flex items-baseline gap-3">
                <h2 className="font-mono text-[15px] font-semibold tracking-[0.02em] text-fg">
                  {quarter.label}
                </h2>
                <span className="font-mono text-[11px] text-fg-3">{quarter.months}</span>
                <span className="font-mono text-[11px] text-fg-3">·</span>
                <span className="font-mono text-[11px] text-fg-3">
                  {quarter.items.length} item{quarter.items.length === 1 ? "" : "s"}
                </span>
                <div className="h-px flex-1 bg-border" />
              </div>
              <div className="space-y-2">
                {quarter.items.map((item) => (
                  <HorizonRow key={item.id} item={item} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function HorizonRow({ item }: { item: HorizonItem }) {
  const jur = JURISDICTIONS.find((j) => j.code === item.jurisdiction);
  const days = daysUntil(item.date);
  const consequence = consequenceLine(item);
  const kindMeta = DEADLINE_KIND_META[item.kind];

  // A process date is a window to act — offer a one-tap scoped Ask that
  // drafts the response, alongside the usual open-the-entry navigation.
  const draftHref =
    item.kind === "process"
      ? `/ask?scopeKind=entry&scopeId=${item.entryId}&scopeLabel=${encodeURIComponent(item.shortName)}&q=${encodeURIComponent(
          `Draft a submission responding to "${item.label}" (closes ${formatDate(item.date)}) for ${item.shortName}. Cover our position, key concerns, and recommended asks.`
        )}`
      : null;

  return (
    <div className="group flex gap-4 rounded-2xl bg-surface p-4 shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-card-hover)]">
      <Link href={`/tracker/${item.entryId}`} className="flex min-w-0 flex-1 gap-4">
        <div className="flex w-[88px] flex-shrink-0 flex-col items-center justify-center rounded-xl bg-accent-bg py-3">
          <span className="font-mono text-[15px] font-bold leading-tight text-accent">
            {shortDate(item.date)}
          </span>
          <span
            className="mt-1 font-mono text-[10px] uppercase tracking-[0.06em]"
            style={{ color: URGENCY[calculateUrgency(item.date)].color }}
          >
            {days === 0 ? "today" : `in ${days}d`}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base leading-none">{jur?.flag}</span>
            <h3 className="text-[15px] font-semibold leading-tight text-fg transition-colors group-hover:text-accent">
              {item.shortName}
            </h3>
            <StatusBadge status={item.status} />
            <ImpactIndicator score={item.impactScore} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-[0.04em] text-fg-3">
            <span
              className="inline-flex items-center gap-1"
              style={{ color: kindMeta.color }}
              title={kindMeta.description}
            >
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
              {kindMeta.label}
            </span>
            <span>{item.label}</span>
          </div>
          {consequence && (
            <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-fg-2">{consequence}</p>
          )}
        </div>
      </Link>

      <div className="flex flex-shrink-0 flex-col items-end justify-center gap-2 self-center">
        {draftHref && (
          <Link
            href={draftHref}
            className="inline-flex items-center gap-1.5 rounded-full bg-hover px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.04em] text-fg-2 transition-colors hover:bg-accent hover:text-white"
            title="Ask Argus to draft a consultation response"
          >
            <PenLine className="h-3 w-3" />
            Draft response
          </Link>
        )}
        <Link
          href={`/tracker/${item.entryId}`}
          className="text-fg-3 transition-colors group-hover:text-fg-2"
          aria-label={`Open ${item.shortName}`}
        >
          <ChevronRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}

// One-line business consequence: the "for us" lens leads; fall back to the
// customer lens (flagged as such), then to the whyItMatters prose. Clamped to
// the first sentence — the full lenses live on the entry page.
function consequenceLine(item: HorizonItem): string | null {
  if (item.impactOnUs) return firstSentence(item.impactOnUs);
  if (item.impactOnCustomers) {
    return `For our customers: ${firstSentence(item.impactOnCustomers)}`;
  }
  if (item.whyItMatters) return firstSentence(item.whyItMatters);
  return null;
}

function firstSentence(text: string): string {
  return text.replace(/^[•\-\s]+/, "").split(/(?<=[.!?])\s/)[0] || text;
}

interface QuarterGroup {
  key: string;
  label: string;
  months: string;
  items: HorizonItem[];
}

function groupByQuarter(items: HorizonItem[]): QuarterGroup[] {
  const groups = new Map<string, QuarterGroup>();
  for (const item of items) {
    const d = new Date(item.date);
    const q = Math.floor(d.getMonth() / 3) + 1;
    const key = `${d.getFullYear()}-Q${q}`;
    let group = groups.get(key);
    if (!group) {
      const monthNames = [0, 1, 2].map((offset) =>
        new Date(d.getFullYear(), (q - 1) * 3 + offset, 1).toLocaleDateString("en-AU", { month: "short" })
      );
      group = {
        key,
        label: `Q${q} ${d.getFullYear()}`,
        months: monthNames.join(" – "),
        items: [],
      };
      groups.set(key, group);
    }
    group.items.push(item);
  }
  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
}

function daysUntil(dateStr: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - today.getTime()) / 86400000);
}

function shortDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

// Paste-ready outlook (compounds with the A3 copy-as-markdown work).
function horizonToMarkdown(
  quarters: QuarterGroup[],
  range: Range,
  jurisdiction: string,
  category: string
): string {
  const jur = JURISDICTIONS.find((j) => j.code === jurisdiction);
  const scope = [
    range === "all" ? "full horizon" : `next ${range} months`,
    jur ? jur.name : null,
    category !== "all" ? category : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const lines: string[] = [`**Regulatory horizon — ${scope}**`, ""];
  for (const quarter of quarters) {
    lines.push(`**${quarter.label}** (${quarter.months})`);
    for (const item of quarter.items) {
      const j = JURISDICTIONS.find((x) => x.code === item.jurisdiction);
      lines.push(
        `- ${formatDate(item.date)} — ${j?.flag || ""} **${item.shortName}**: ${item.label}`
      );
      const consequence = consequenceLine(item);
      if (consequence) lines.push(`  ${consequence}`);
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}
