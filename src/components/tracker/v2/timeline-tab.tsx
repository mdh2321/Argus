"use client";

// Timeline — legislative movement only.
//
// v1 merged three strands onto one axis: key dates, every applied field change,
// and linked digest stories. On a generated entry the field changes dominate —
// a single summary run writes ten rows ("summary updated", "penalties updated")
// that describe our database, not the instrument. Those are gone.
//
// What remains is movement of the law itself, assembled from three real
// sources:
//   • the entry's own key dates
//   • commencement of amendments that affect it (the `amendment_commenced`
//     change kind, which is a legislative event, not an edit)
//   • dated milestones on the amending / subordinate instruments linked to it
//
// The third is what makes the timeline useful on an anchor like the Privacy
// Act, whose own keyDates are often empty while the instruments amending it
// carry the dates that matter.

import Link from "next/link";
import type { EntryDetailResponse, RelatedEntryWithKind } from "@/lib/types";
import { URGENCY } from "@/lib/constants";
import { calculateUrgency, formatDate } from "@/lib/utils";

export interface TimelineEvent {
  date: string;
  title: string;
  detail: string | null;
  href: string | null;
  origin: string;
}

/**
 * Assemble the instrument's dated movement. Exported because the fact rail
 * derives "next material change" from the same set — the rail and the timeline
 * disagreeing about what is coming next would be worse than either being
 * slightly incomplete.
 */
export function collectInstrumentEvents(data: EntryDetailResponse): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const entry = data.entry;

  for (const kd of entry.keyDates ?? []) {
    if (!kd.date) continue;
    events.push({
      date: kd.date.slice(0, 10),
      title: kd.label || "Key date",
      detail: null,
      href: null,
      origin: "This instrument",
    });
  }

  // Commencements are legislative events; ordinary field edits are not.
  for (const change of data.changes ?? []) {
    if (change.fieldChanged !== "amendment_commenced") continue;
    events.push({
      date: change.changedAt.slice(0, 10),
      title: "Amendment commenced",
      detail: change.changeSummary ?? null,
      href: null,
      origin: "This instrument",
    });
  }

  // Dates on the instruments around this one are frequently the only dates
  // that exist: an anchor Act like the Privacy Act carries no keyDates of its
  // own, while the code made under it and the amending instrument that
  // references it both commence on fixed days. Those are movements in this
  // instrument's compliance surface, so they belong on its timeline.
  const linked: [RelatedEntryWithKind[], string][] = [
    [data.inFlightAmendments ?? [], "Pending amendment"],
    [data.amendmentHistory ?? [], "Amendment"],
    [data.relatedSubordinates ?? [], "Made under this"],
    [data.relatedGuidance ?? [], "Guidance"],
    [data.relatedInstruments ?? [], "Cross-referenced"],
  ];

  for (const [items, origin] of linked) {
    for (const item of items) {
      if (!item.nextKeyDate) continue;
      events.push({
        date: item.nextKeyDate.slice(0, 10),
        title: item.shortName,
        detail: null,
        href: `/tracker/${item.id}`,
        origin,
      });
    }
  }

  // Same instrument can contribute the same date twice (e.g. an effective date
  // that is also the compliance deadline) — collapse exact duplicates.
  const seen = new Set<string>();
  return events.filter((e) => {
    const key = `${e.date}|${e.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function TimelineTab({ data }: { data: EntryDetailResponse }) {
  const events = collectInstrumentEvents(data);

  if (events.length === 0) {
    return (
      <p className="text-[15px] text-fg-3">
        No dated legislative movement recorded. Key dates extracted from the source text and
        commencements of linked amendments will appear here.
      </p>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = events.filter((e) => e.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const past = events.filter((e) => e.date < today).sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="max-w-3xl space-y-10">
      {upcoming.length > 0 && (
        <TimelineGroup label="Ahead" events={upcoming} future />
      )}
      {past.length > 0 && <TimelineGroup label="Behind" events={past} future={false} />}
    </div>
  );
}

function TimelineGroup({
  label,
  events,
  future,
}: {
  label: string;
  events: TimelineEvent[];
  future: boolean;
}) {
  return (
    <div>
      <h2 className="mb-4 font-mono text-[11px] uppercase tracking-[0.06em] text-fg-3">{label}</h2>
      <ol className="space-y-0">
        {events.map((event, i) => (
          <li
            key={`${event.date}-${i}`}
            className="grid grid-cols-[6.5rem_1rem_minmax(0,1fr)] gap-x-4 border-t border-border py-4 first:border-t-0 sm:grid-cols-[7.5rem_1rem_minmax(0,1fr)]"
          >
            <div>
              <div className="font-mono text-[14px] tabular-nums text-fg">
                {formatDate(event.date)}
              </div>
              {future && (
                <div
                  className="mt-0.5 font-mono text-[11px]"
                  style={{ color: URGENCY[calculateUrgency(event.date)].color }}
                >
                  {URGENCY[calculateUrgency(event.date)].label}
                </div>
              )}
            </div>

            <div className="relative flex justify-center">
              <span
                className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full"
                style={{
                  background: future
                    ? URGENCY[calculateUrgency(event.date)].color
                    : "var(--fg-3)",
                }}
              />
            </div>

            <div className="min-w-0">
              {event.href ? (
                <Link
                  href={event.href}
                  className="text-[16px] font-medium text-fg transition-colors hover:text-accent"
                >
                  {event.title}
                </Link>
              ) : (
                <span className="text-[16px] font-medium text-fg">{event.title}</span>
              )}
              <div className="mt-0.5 font-mono text-[11px] uppercase tracking-[0.05em] text-fg-3">
                {event.origin}
              </div>
              {event.detail && (
                <p className="mt-1 text-[14px] leading-relaxed text-fg-2">{event.detail}</p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
