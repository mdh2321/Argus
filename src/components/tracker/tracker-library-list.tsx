"use client";

import Link from "next/link";
import { ArrowDown, ArrowUp, SearchX } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { InstrumentTypeIcon, instrumentTypeLabel } from "@/components/ui/instrument-type-icon";
import { JurisdictionBadge } from "@/components/ui/jurisdiction-badge";
import { RELATIONSHIP_KINDS, STATUSES, type TrackerLifecycle } from "@/lib/constants";
import type { Entry } from "@/lib/types";
import { formatDate } from "@/lib/utils";

export type TrackerSortField =
  | "jurisdiction"
  | "short_name"
  | "status"
  | "next_key_date"
  | "type"
  | "impact_score";

type SortOrder = "asc" | "desc";
type Density = "comfortable" | "compact";

interface TrackerLibraryListProps {
  entries: Entry[];
  lifecycle: TrackerLifecycle;
  density: Density;
  sortField: TrackerSortField;
  sortOrder: SortOrder;
  onSort: (field: TrackerSortField) => void;
}

const BASE_GRID =
  "grid min-w-[850px] grid-cols-[76px_minmax(300px,1fr)_148px_190px_64px] items-center gap-3";
const UPCOMING_GRID =
  "grid min-w-[1040px] grid-cols-[76px_minmax(280px,1fr)_148px_172px_190px_64px] items-center gap-3";

export function TrackerLibraryList({
  entries,
  lifecycle,
  density,
  sortField,
  sortOrder,
  onSort,
}: TrackerLibraryListProps) {
  const showNextDate = lifecycle === "upcoming";
  const gridClass = showNextDate ? UPCOMING_GRID : BASE_GRID;

  if (entries.length === 0) {
    return (
      <EmptyState
        icon={SearchX}
        title="No legislation matches these filters"
        description="Try a broader search or remove one of the filters above."
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <div className={`${gridClass} border-b border-border px-1 text-[11px] font-medium text-fg-3`} role="row">
        <SortHeader
          label="Jurisdiction"
          field="jurisdiction"
          current={sortField}
          order={sortOrder}
          onSort={onSort}
        />
        <SortHeader
          label="Legislation"
          field="short_name"
          current={sortField}
          order={sortOrder}
          onSort={onSort}
        />
        <SortHeader
          label="Status"
          field="status"
          current={sortField}
          order={sortOrder}
          onSort={onSort}
        />
        {showNextDate && (
          <SortHeader
            label="Next date"
            field="next_key_date"
            current={sortField}
            order={sortOrder}
            onSort={onSort}
          />
        )}
        <SortHeader
          label="Type"
          field="type"
          current={sortField}
          order={sortOrder}
          onSort={onSort}
        />
        <SortHeader
          label="Impact"
          field="impact_score"
          current={sortField}
          order={sortOrder}
          onSort={onSort}
        />
      </div>

      <ul className="m-0 list-none p-0">
        {entries.map((entry) => (
          <TrackerLibraryRow
            key={entry.id}
            entry={entry}
            density={density}
            showNextDate={showNextDate}
            gridClass={gridClass}
          />
        ))}
      </ul>
    </div>
  );
}

function TrackerLibraryRow({
  entry,
  density,
  showNextDate,
  gridClass,
}: {
  entry: Entry;
  density: Density;
  showNextDate: boolean;
  gridClass: string;
}) {
  const status = STATUSES.find((item) => item.value === entry.status);
  const nextMilestone = entry.keyDates?.find((date) => date.date === entry.nextKeyDate);
  const relationship = RELATIONSHIP_KINDS.find(
    (item) => item.value === entry.parentRelationshipKind
  );
  const meta = [
    entry.category,
    entry.parentShortName
      ? `${relationship?.verb ?? "Part of"} ${entry.parentShortName}`
      : null,
  ].filter(Boolean);

  return (
    <li
      className={`${gridClass} border-b border-border px-1 transition-colors hover:bg-hover ${
        density === "comfortable" ? "min-h-[74px] py-2.5" : "min-h-[50px] py-1.5"
      }`}
    >
      <JurisdictionBadge code={entry.jurisdiction} />

      <div className="min-w-0">
        <h3 className="m-0 truncate text-[14px] font-medium leading-snug text-fg">
          <Link
            href={`/tracker/${entry.id}`}
            className="rounded-sm underline-offset-4 transition-colors hover:text-accent-text hover:underline"
          >
            {entry.shortName}
          </Link>
        </h3>
        {density === "comfortable" && entry.summary && (
          <p className="mt-1 truncate text-[12px] leading-snug text-fg-2">
            {entry.summary}
          </p>
        )}
        {density === "comfortable" && meta.length > 0 && (
          <p className="mt-0.5 truncate text-[11px] text-fg-3">{meta.join(" · ")}</p>
        )}
      </div>

      <span
        className="inline-flex items-center gap-2 whitespace-nowrap text-[12px] font-medium"
        style={{ color: status?.color ?? "var(--fg-3)" }}
      >
        <span className="h-2 w-2 rounded-full border-2 border-current" aria-hidden="true" />
        {status?.label ?? entry.status.replaceAll("_", " ")}
      </span>

      {showNextDate && (
        <span className="min-w-0">
          <span className="block whitespace-nowrap text-[12px] font-medium tabular-nums text-fg">
            {formatDate(entry.nextKeyDate)}
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-fg-3">
            {nextMilestone?.label || (entry.nextKeyDate ? "Next milestone" : "Date not set")}
          </span>
        </span>
      )}

      <span className="inline-flex min-w-0 items-center gap-2 whitespace-nowrap text-[12px] text-fg-2">
        <InstrumentTypeIcon type={entry.type} tone="muted" className="h-4 w-4" />
        <span className="truncate">{instrumentTypeLabel(entry.type)}</span>
      </span>

      <span
        className="whitespace-nowrap text-[12px] font-medium tabular-nums text-fg"
        aria-label={entry.impactScore ? `Impact ${entry.impactScore} of 5` : "Impact not assessed"}
      >
        {entry.impactScore ? `${entry.impactScore}/5` : "—"}
      </span>
    </li>
  );
}

function SortHeader({
  label,
  field,
  current,
  order,
  onSort,
}: {
  label: string;
  field: TrackerSortField;
  current: TrackerSortField;
  order: SortOrder;
  onSort: (field: TrackerSortField) => void;
}) {
  const active = current === field;
  return (
    <div role="columnheader" aria-sort={active ? (order === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={() => onSort(field)}
        className={`inline-flex min-h-8 items-center gap-1 rounded px-0.5 text-left transition-colors hover:text-fg ${
          active ? "text-fg" : "text-fg-3"
        }`}
      >
        {label}
        {active &&
          (order === "asc" ? (
            <ArrowUp className="h-3 w-3 text-accent" aria-hidden="true" />
          ) : (
            <ArrowDown className="h-3 w-3 text-accent" aria-hidden="true" />
          ))}
      </button>
    </div>
  );
}
