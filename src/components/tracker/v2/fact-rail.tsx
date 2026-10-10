"use client";

// The right rail: formal metadata, then a single record-state line.
//
// v1 spread this across a masthead badge row, a Quick Facts card, and up to
// five banners. Here it is one column: the facts a lawyer quotes into a memo,
// closing with a plain-English verdict on whether the page can be relied on.

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { EntryDetailResponse, SourceDocument } from "@/lib/types";
import { ENTRY_TYPES, JURISDICTIONS, STATUSES, IMPACT_LABELS } from "@/lib/constants";
import { formatDate } from "@/lib/utils";
import { computeRecordState, stateSummary, type RecordStateItem } from "./record-state";
import { collectInstrumentEvents } from "./timeline-tab";

// Soonest future event on the instrument timeline. Same source as the Timeline
// tab, so the rail can never advertise a different "next change" than the tab.
function nextMaterialChange(
  data: EntryDetailResponse
): { date: string; label: string } | null {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne" }).format(new Date());
  const upcoming = collectInstrumentEvents(data)
    .filter((e) => e.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  const next = upcoming[0];
  return next ? { date: next.date, label: next.title } : null;
}

export function FactRail({
  data,
  documents,
  onRegenerate,
}: {
  data: EntryDetailResponse;
  documents: SourceDocument[] | undefined;
  onRegenerate?: () => void;
}) {
  const entry = data.entry;
  const docs = documents ?? [];
  const primary = docs.find((d) => d.role === "primary_text");
  const hasPrimary = !!(primary && primary.fullText);
  const state = computeRecordState(entry, documents, { onRegenerate });

  const typeLabel = ENTRY_TYPES.find((t) => t.value === entry.type)?.label ?? entry.type;
  const statusLabel = STATUSES.find((s) => s.value === entry.status)?.label ?? entry.status;
  const jurisdiction =
    JURISDICTIONS.find((j) => j.code === entry.jurisdiction)?.name ?? entry.jurisdiction;
  const upcoming = nextMaterialChange(data);

  const facts: { label: string; value: React.ReactNode }[] = [
    { label: "Status", value: statusLabel },
    {
      label: "Direct impact",
      value: entry.impactScore
        ? `${IMPACT_LABELS[entry.impactScore] ?? entry.impactScore}`
        : "Not scored",
    },
    { label: "Instrument type", value: typeLabel },
    { label: "Jurisdiction", value: jurisdiction },
  ];

  if (entry.regulator) facts.push({ label: "Regulator", value: entry.regulator });
  if (upcoming) {
    facts.push({
      label: "Next material change",
      value: (
        <>
          {formatDate(upcoming.date)}
          <span className="mt-0.5 block text-[12px] text-fg-3">{upcoming.label}</span>
        </>
      ),
    });
  }
  facts.push({
    label: "Evidence",
    value: documents === undefined ? "Not yet loaded" : hasPrimary
      ? `${docs.length} attached · primary text held`
      : `${docs.length} attached · no primary text`,
  });
  facts.push({ label: "Record updated", value: formatDate(entry.updatedAt) });

  return (
    <div className="space-y-5">
      <dl className="space-y-3.5">
        {facts.map((f) => (
          <div key={f.label}>
            <dt className="font-mono text-[11px] uppercase tracking-[0.06em] text-fg-3">
              {f.label}
            </dt>
            <dd className="mt-0.5 text-[14px] leading-snug text-fg">{f.value}</dd>
          </div>
        ))}
      </dl>

      <RecordStatePanel items={state} summary={stateSummary(state, hasPrimary)} />
    </div>
  );
}

function RecordStatePanel({
  items,
  summary,
}: {
  items: RecordStateItem[];
  summary: string;
}) {
  const [open, setOpen] = useState(false);
  const worst = items.find((i) => i.level === "blocking")
    ? "blocking"
    : items.find((i) => i.level === "advisory")
      ? "advisory"
      : "routine";

  const tone =
    worst === "blocking"
      ? "text-amber-text"
      : worst === "advisory"
        ? "text-fg-2"
        : "text-fg-3";

  return (
    <div className="border-t border-border pt-4">
      <p className={`text-[14px] leading-relaxed ${tone}`}>{summary}</p>
      {items.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="mt-2 flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.06em] text-fg-3 transition-colors hover:text-accent"
            aria-expanded={open}
          >
            <ChevronRight
              className={`h-3 w-3 transition-transform duration-150 ${open ? "rotate-90" : ""}`}
            />
            Record state
          </button>
          {open && (
            <ul className="mt-2.5 space-y-2.5">
              {items.map((item) => (
                <li key={item.label} className="text-[13px] leading-relaxed">
                  <span
                    className={`block font-medium ${
                      item.level === "blocking" ? "text-amber-text" : "text-fg-2"
                    }`}
                  >
                    {item.label}
                  </span>
                  <span className="text-fg-3">{item.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
