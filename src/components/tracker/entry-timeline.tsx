"use client";

import Link from "next/link";
import { Calendar, GitCommit, Newspaper, ExternalLink } from "lucide-react";
import type { EntryChange, KeyDate } from "@/lib/types";
import { URGENCY } from "@/lib/constants";
import { calculateUrgency, formatDate, relativeTime } from "@/lib/utils";

// C2 — the per-entry timeline: a merged chronological "story of this
// instrument" over three strands that already exist — future/past key dates,
// applied change history (what changed, when, sourced — including amendment
// commencements from A2), and linked digest stories (what was reported). A
// read-only merge; no AI cost.

interface TimelineStory {
  id: string;
  title: string;
  date: string;
  source: string;
  url: string | null;
  issueSlug: string | null;
}

type TimelineEvent =
  | { kind: "date"; date: string; label: string }
  | { kind: "change"; date: string; change: EntryChange }
  | { kind: "story"; date: string; story: TimelineStory };

const FIELD_LABELS: Record<string, string> = {
  status: "Status",
  key_dates: "Key dates",
  regulator: "Regulator",
  penalties: "Penalties",
  amendment_commenced: "Amendment commenced",
};

function toDay(value: string): string {
  // Accepts YYYY-MM-DD or a full ISO timestamp; returns the date portion.
  return value.slice(0, 10);
}

export function EntryTimeline({
  keyDates,
  changes,
  stories,
}: {
  keyDates: KeyDate[];
  changes: EntryChange[];
  stories: TimelineStory[];
}) {
  const events: TimelineEvent[] = [
    ...keyDates
      .filter((k) => k.date)
      .map((k): TimelineEvent => ({ kind: "date", date: k.date, label: k.label })),
    ...changes.map((c): TimelineEvent => ({ kind: "change", date: toDay(c.changedAt), change: c })),
    ...stories
      .filter((s) => s.date)
      .map((s): TimelineEvent => ({ kind: "story", date: toDay(s.date), story: s })),
  ];

  if (events.length === 0) {
    return (
      <p className="text-[12px] text-fg-3">
        Nothing on the timeline yet — key dates, changes, and reported stories will appear here.
      </p>
    );
  }

  // Most recent / soonest-future first, so upcoming deadlines and fresh changes
  // sit at the top where they're wanted before a meeting.
  events.sort((a, b) => b.date.localeCompare(a.date));

  const today = new Date().toISOString().slice(0, 10);

  return (
    <ol className="relative ml-1 space-y-4 border-l border-border pl-5">
      {events.map((ev, i) => (
        <TimelineRow key={i} event={ev} isFuture={ev.date >= today} />
      ))}
    </ol>
  );
}

function TimelineRow({ event, isFuture }: { event: TimelineEvent; isFuture: boolean }) {
  let dotColor = "var(--fg-3)";
  let Icon = Calendar;

  if (event.kind === "date") {
    const urgency = isFuture ? calculateUrgency(event.date) : "future";
    dotColor = URGENCY[urgency].color;
    Icon = Calendar;
  } else if (event.kind === "change") {
    dotColor = "var(--accent)";
    Icon = GitCommit;
  } else {
    dotColor = "var(--cyan)";
    Icon = Newspaper;
  }

  return (
    <li className="relative">
      <span
        className="absolute -left-[27px] top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full ring-4 ring-bg"
        style={{ background: dotColor }}
      />
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-fg-3" />
        <div className="min-w-0 flex-1">
          {event.kind === "date" && (
            <>
              <div className="text-[13px] text-fg">{event.label || "Key date"}</div>
              <div className="mt-0.5 text-[11px] text-fg-3 tabular-nums">
                {formatDate(event.date)}
                {isFuture && (
                  <span className="ml-2" style={{ color: dotColor }}>
                    {URGENCY[calculateUrgency(event.date)].label}
                  </span>
                )}
              </div>
            </>
          )}

          {event.kind === "change" && (
            <>
              <div className="text-[13px] text-fg">
                <span className="font-medium">
                  {FIELD_LABELS[event.change.fieldChanged] ?? event.change.fieldChanged}
                </span>
                {event.change.fieldChanged === "amendment_commenced" ? "" : " updated"}
              </div>
              {event.change.changeSummary && (
                <div className="mt-0.5 text-[11px] text-fg-3">{event.change.changeSummary}</div>
              )}
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-fg-3">
                <span className="tabular-nums">{relativeTime(event.change.changedAt)}</span>
                <span className="rounded bg-hover px-1.5 py-px text-fg-3">{event.change.changedBy}</span>
                {event.change.sourceUrl && (
                  <a
                    href={event.change.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-0.5 hover:text-accent"
                  >
                    source <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                )}
              </div>
            </>
          )}

          {event.kind === "story" && (
            <>
              {event.story.issueSlug ? (
                <Link
                  href={`/digest/issues/${event.story.issueSlug}#${event.story.id}`}
                  className="text-[13px] text-fg hover:text-accent"
                >
                  {event.story.title}
                </Link>
              ) : event.story.url ? (
                <a
                  href={event.story.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[13px] text-fg hover:text-accent"
                >
                  {event.story.title}
                </a>
              ) : (
                <span className="text-[13px] text-fg">{event.story.title}</span>
              )}
              <div className="mt-0.5 text-[11px] text-fg-3">
                Reported · {event.story.source} · {formatDate(event.date)}
              </div>
            </>
          )}
        </div>
      </div>
    </li>
  );
}
