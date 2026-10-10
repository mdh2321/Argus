"use client";

import { Suspense, useCallback, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { List, Plus, Rows3 } from "lucide-react";
import { FilterBar } from "@/components/tracker/filter-bar";
import {
  TrackerLibraryList,
  type TrackerSortField,
} from "@/components/tracker/tracker-library-list";
import { SkeletonList } from "@/components/ui/skeleton";
import { useEntries } from "@/hooks/use-entries";
import {
  LIVE_ENTRY_STATUSES,
  UPCOMING_ENTRY_STATUSES,
  type TrackerLifecycle,
} from "@/lib/constants";

type Density = "comfortable" | "compact";
type SortOrder = "asc" | "desc";

const SORT_FIELDS: TrackerSortField[] = [
  "jurisdiction",
  "short_name",
  "status",
  "next_key_date",
  "type",
  "impact_score",
];

export default function TrackerPage() {
  return (
    <Suspense
      fallback={
        <div className="mt-8" role="status" aria-label="Loading tracker records">
          <SkeletonList rows={8} />
        </div>
      }
    >
      <TrackerContent />
    </Suspense>
  );
}

function TrackerContent() {
  const searchParams = useSearchParams();
  const initialLifecycle = parseLifecycle(searchParams.get("lifecycle"));
  const initialSort = parseSortField(searchParams.get("sort")) ??
    (initialLifecycle === "upcoming" ? "next_key_date" : "short_name");

  const [filters, setFilters] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    searchParams.forEach((value, key) => {
      if (!["search", "sort", "order", "page", "limit", "lifecycle", "anchored"].includes(key)) {
        initial[key] = value;
      }
    });
    return initial;
  });
  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [lifecycle, setLifecycle] = useState<TrackerLifecycle>(initialLifecycle);
  const [density, setDensity] = useState<Density>("comfortable");
  const [sortField, setSortField] = useState<TrackerSortField>(initialSort);
  const [sortOrder, setSortOrder] = useState<SortOrder>(
    searchParams.get("order") === "desc" ? "desc" : "asc"
  );
  const [page, setPage] = useState(
    Math.max(1, Number.parseInt(searchParams.get("page") || "1", 10) || 1)
  );

  const params: Record<string, string> = {
    ...filters,
    lifecycle: lifecycle === "all" ? "" : lifecycle,
    sort: sortField,
    order: sortOrder,
    page: String(page),
    limit: "50",
  };
  if (search) params.search = search;
  Object.keys(params).forEach((key) => {
    if (!params[key]) delete params[key];
  });

  const { data, isLoading } = useEntries(params);

  const changeLifecycle = useCallback((next: TrackerLifecycle) => {
    setLifecycle(next);
    setFilters((previous) => {
      const status = previous.status;
      if (!status || next === "all" || statusMatchesLifecycle(status, next)) return previous;
      return { ...previous, status: "" };
    });
    setSortField(next === "upcoming" ? "next_key_date" : "short_name");
    setSortOrder("asc");
    setPage(1);
  }, []);

  const handleFilterChange = useCallback(
    (key: string, value: string) => {
      setFilters((previous) => ({ ...previous, [key]: value }));
      if (key === "status" && value && lifecycle !== "all" && !statusMatchesLifecycle(value, lifecycle)) {
        const inferred = lifecycleForStatus(value);
        setLifecycle(inferred);
        setSortField(inferred === "upcoming" ? "next_key_date" : "short_name");
        setSortOrder("asc");
      }
      setPage(1);
    },
    [lifecycle]
  );

  const handleClearFilters = useCallback(() => {
    setFilters({});
    setSearch("");
    setPage(1);
  }, []);

  const handleSort = useCallback(
    (field: TrackerSortField) => {
      if (field === sortField) {
        setSortOrder((current) => (current === "asc" ? "desc" : "asc"));
      } else {
        setSortField(field);
        setSortOrder("asc");
      }
      setPage(1);
    },
    [sortField]
  );

  const counts = data?.lifecycleCounts ?? { all: 0, live: 0, upcoming: 0 };

  return (
    <div className="anim-enter">
      <header className="flex items-center justify-between gap-4 pb-4">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.03em] text-fg">
            Tracker
          </h1>
          <span className="text-[12px] tabular-nums text-fg-3">
            {counts.all ? `${counts.all} legislation records` : "Loading records…"}
          </span>
        </div>
        <Link
          href="/tracker/new"
          className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 text-[12px] font-medium text-white transition-colors hover:bg-accent-2"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          New entry
        </Link>
      </header>

      <FilterBar
        filters={filters}
        onFilterChange={handleFilterChange}
        onClearFilters={handleClearFilters}
        onSearch={(value) => {
          setSearch(value);
          setPage(1);
        }}
        searchValue={search}
      />

      <section className="mt-3" aria-labelledby="tracker-library-heading" aria-busy={isLoading}>
        <h2 id="tracker-library-heading" className="sr-only">Legislation library</h2>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-2">
          <div className="flex flex-wrap items-center gap-3">
            <fieldset className="inline-flex rounded-lg border border-border bg-hover p-0.5">
              <legend className="sr-only">Lifecycle</legend>
              <LifecycleButton
                label="All"
                count={counts.all}
                selected={lifecycle === "all"}
                onClick={() => changeLifecycle("all")}
              />
              <LifecycleButton
                label="Live"
                count={counts.live}
                selected={lifecycle === "live"}
                onClick={() => changeLifecycle("live")}
              />
              <LifecycleButton
                label="Upcoming"
                count={counts.upcoming}
                selected={lifecycle === "upcoming"}
                onClick={() => changeLifecycle("upcoming")}
              />
            </fieldset>
            <span className="text-[12px] tabular-nums text-fg-3" aria-live="polite">
              {isLoading
                ? "Updating…"
                : data?.total === 1
                  ? "1 record"
                  : `${data?.total ?? 0} records`}
            </span>
          </div>

          <fieldset className="inline-flex rounded-lg border border-border bg-hover p-0.5">
            <legend className="sr-only">Record density</legend>
            <DensityButton
              label="Comfortable"
              selected={density === "comfortable"}
              onClick={() => setDensity("comfortable")}
              Icon={Rows3}
            />
            <DensityButton
              label="Compact"
              selected={density === "compact"}
              onClick={() => setDensity("compact")}
              Icon={List}
            />
          </fieldset>
        </div>

        <div>
          {isLoading ? (
            <div className="mt-3" role="status" aria-label="Loading tracker records">
              <SkeletonList rows={8} />
            </div>
          ) : (
            <TrackerLibraryList
              entries={data?.entries || []}
              lifecycle={lifecycle}
              density={density}
              sortField={sortField}
              sortOrder={sortOrder}
              onSort={handleSort}
            />
          )}
        </div>

        {data && data.totalPages > 1 && (
          <nav aria-label="Tracker pagination" className="mt-4 flex items-center justify-between">
            <span className="text-[12px] tabular-nums text-fg-3">
              Page {data.page} of {data.totalPages}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page === 1}
                className="inline-flex min-h-9 items-center rounded-lg border border-border px-3 text-[12px] font-medium text-fg-2 transition-colors hover:bg-hover hover:text-fg disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setPage((current) => Math.min(data.totalPages, current + 1))}
                disabled={page === data.totalPages}
                className="inline-flex min-h-9 items-center rounded-lg border border-border px-3 text-[12px] font-medium text-fg-2 transition-colors hover:bg-hover hover:text-fg disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </nav>
        )}
      </section>
    </div>
  );
}

function LifecycleButton({
  label,
  count,
  selected,
  onClick,
}: {
  label: string;
  count: number;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`inline-flex min-h-8 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium transition-colors ${
        selected ? "bg-surface text-fg shadow-sm" : "text-fg-3 hover:text-fg"
      }`}
    >
      {label}
      <span className="tabular-nums text-fg-3">{count}</span>
    </button>
  );
}

function DensityButton({
  label,
  selected,
  onClick,
  Icon,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
  Icon: typeof Rows3;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium transition-colors ${
        selected ? "bg-surface text-fg shadow-sm" : "text-fg-3 hover:text-fg"
      }`}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </button>
  );
}

function parseLifecycle(value: string | null): TrackerLifecycle {
  return value === "live" || value === "upcoming" ? value : "all";
}

function parseSortField(value: string | null): TrackerSortField | null {
  return value && SORT_FIELDS.includes(value as TrackerSortField)
    ? (value as TrackerSortField)
    : null;
}

function lifecycleForStatus(status: string): TrackerLifecycle {
  if ((LIVE_ENTRY_STATUSES as readonly string[]).includes(status)) return "live";
  if ((UPCOMING_ENTRY_STATUSES as readonly string[]).includes(status)) return "upcoming";
  return "all";
}

function statusMatchesLifecycle(status: string, lifecycle: TrackerLifecycle): boolean {
  return lifecycle === "all" || lifecycleForStatus(status) === lifecycle;
}
