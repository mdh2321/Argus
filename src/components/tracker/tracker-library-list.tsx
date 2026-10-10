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
  "grid grid-cols-2 lg:grid-cols-[76px_minmax(180px,1fr)_120px_145px_54px] items-center gap-x-4 gap-y-3";
const UPCOMING_GRID =
  "grid grid-cols-2 lg:grid-cols-[60px_minmax(180px,1fr)_115px_115px_130px_45px] items-center gap-x-3 gap-y-3";

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
    <div>
      <div className="flex flex-wrap items-center gap-3 border-b border-border py-3 lg:hidden">
        <label htmlFor="tracker-sort" className="text-[12px] text-fg-3">Sort by</label>
        <select id="tracker-sort" value={sortField} onChange={(event) => onSort(event.target.value as TrackerSortField)} className="min-h-11 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 text-[14px] text-fg">
          <option value="short_name">Legislation</option>
          <option value="jurisdiction">Jurisdiction</option>
          <option value="status">Status</option>
          {showNextDate && <option value="next_key_date">Next date</option>}
          <option value="type">Type</option>
          <option value="impact_score">Impact</option>
        </select>
        <button type="button" onClick={() => onSort(sortField)} aria-label={sortOrder === "asc" ? "Sort descending" : "Sort ascending"} className="flex h-11 w-11 items-center justify-center rounded-lg border border-border text-fg-2 hover:bg-hover">
          {sortOrder === "asc" ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
        </button>
      </div>
      <div className={`${gridClass} hidden lg:grid border-b border-border px-3 py-2 text-[12px] font-medium text-fg-3`} role="row">
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
      className={`${gridClass} border-b border-border px-3 transition-colors duration-200 hover:bg-hover focus-within:bg-hover ${
        density === "comfortable" ? "min-h-[100px] py-5" : "min-h-[64px] py-3"
      }`}
    >
      <div className="order-0"><JurisdictionBadge code={entry.jurisdiction} /></div>

      <div className="order-2 col-span-2 min-w-0 lg:order-none lg:col-span-1">
        <h3 className="m-0 text-[16px] font-medium leading-snug text-fg">
          <Link
            href={`/tracker/${entry.id}`}
            className="rounded-sm underline-offset-4 transition-colors hover:text-accent-text hover:underline"
          >
            {entry.shortName}
          </Link>
        </h3>
        {density === "comfortable" && entry.summary && (
          <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-fg-2">
            {entry.summary}
          </p>
        )}
        {density === "comfortable" && meta.length > 0 && (
          <p className="mt-1 line-clamp-2 text-[12px] text-fg-3">{meta.join(" · ")}</p>
        )}
      </div>

      <span
        className="order-1 inline-flex items-center justify-end gap-2 text-right text-[12px] font-medium lg:order-none lg:justify-start lg:text-left"
        style={{ color: status?.color ?? "var(--fg-3)" }}
      >
        <span className="h-2 w-2 rounded-full border-2 border-current" aria-hidden="true" />
        {status?.label ?? entry.status.replaceAll("_", " ")}
      </span>

      {showNextDate && (
        <span className="order-3 col-span-2 min-w-0 lg:order-none lg:col-span-1">
          <span className="block whitespace-nowrap text-[12px] font-medium tabular-nums text-fg">
            {formatDate(entry.nextKeyDate)}
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-fg-3">
            {nextMilestone?.label || (entry.nextKeyDate ? "Next milestone" : "Date not set")}
          </span>
        </span>
      )}

      <span className="order-4 inline-flex min-w-0 items-center gap-2 text-[12px] text-fg-2 lg:order-none">
        <InstrumentTypeIcon type={entry.type} tone="muted" className="h-4 w-4" />
        <span className="truncate">{instrumentTypeLabel(entry.type)}</span>
      </span>

      <span
        className="order-5 whitespace-nowrap text-right text-[12px] font-medium tabular-nums text-fg lg:order-none lg:text-left"
        aria-label={entry.impactScore ? `Impact ${entry.impactScore} of 5` : "Impact not assessed"}
      >
        <span className="mr-1 text-fg-3 lg:hidden">Impact</span>
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
