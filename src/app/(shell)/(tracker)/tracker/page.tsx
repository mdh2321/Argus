"use client";

import { useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useEntries } from "@/hooks/use-entries";
import { FilterBar } from "@/components/tracker/filter-bar";
import { EntriesTable } from "@/components/tracker/entries-table";
import { EntriesKanban } from "@/components/tracker/entries-kanban";
import { EntriesGrid } from "@/components/tracker/entries-grid";
import { ScanButton } from "@/components/tracker/scan-button";
import { ChevronLeft, ChevronRight, CalendarClock, Sparkles, Database, Rows3, List, LayoutGrid, KanbanSquare, Table as TableIcon, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";

export default function TrackerPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-24">
          <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <TrackerContent />
    </Suspense>
  );
}

function TrackerContent() {
  const searchParams = useSearchParams();

  const [filters, setFilters] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    searchParams.forEach((v, k) => { init[k] = v; });
    return init;
  });
  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [viewMode, setViewMode] = useState<"list" | "table" | "kanban">("list");
  const [listDensity, setListDensity] = useState<"default" | "condensed">("default");
  const [sortField, setSortField] = useState("updated_at");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);

  const params: Record<string, string> = {
    ...filters,
    sort: sortField,
    order: sortOrder,
    page: String(page),
    limit: "50",
  };
  if (search) params.search = search;
  Object.keys(params).forEach((k) => { if (!params[k]) delete params[k]; });

  // Flat list — every entry (parent or subordinate instrument) gets its own
  // row. Children carry a parentShortName breadcrumb for context.

  const { data, mutate, isLoading } = useEntries(params);

  const handleFilterChange = useCallback((key: string, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  }, []);

  const handleClearFilters = useCallback(() => {
    setFilters({});
    setSearch("");
    setPage(1);
  }, []);

  return (
    <div className="anim-enter">
      {/* Header */}
      <div className="flex items-end justify-between mb-6">
        <div className="relative grid-pattern py-4">
          <div className="flex items-center gap-2.5 relative z-10">
            <Database className="w-5 h-5" style={{ color: "var(--green)" }} />
            <h1 className="text-gradient text-[28px] font-bold tracking-[-0.02em]">
              Tracker
            </h1>
          </div>
          <p className="text-[14px] text-fg-3 mt-1.5 relative z-10">
            {data ? `${data.total} entries tracked across APAC` : "Loading..."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-xl border border-border overflow-hidden mr-1">
            <button
              onClick={() => setViewMode("list")}
              className={`flex items-center gap-1 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.04em] transition-colors ${
                viewMode === "list"
                  ? "bg-accent text-white"
                  : "text-fg-3 hover:text-fg-2 hover:bg-hover"
              }`}
              title="List view"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setViewMode("table")}
              className={`flex items-center gap-1 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.04em] transition-colors border-l border-border ${
                viewMode === "table"
                  ? "bg-accent text-white"
                  : "text-fg-3 hover:text-fg-2 hover:bg-hover"
              }`}
              title="Table view"
            >
              <TableIcon className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setViewMode("kanban")}
              className={`flex items-center gap-1 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.04em] transition-colors border-l border-border ${
                viewMode === "kanban"
                  ? "bg-accent text-white"
                  : "text-fg-3 hover:text-fg-2 hover:bg-hover"
              }`}
              title="Kanban view"
            >
              <KanbanSquare className="w-3.5 h-3.5" />
            </button>
          </div>
          {viewMode === "list" && (
            <div className="flex items-center rounded-xl border border-border overflow-hidden mr-1">
              <button
                onClick={() => setListDensity("default")}
                className={`flex items-center gap-1 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.04em] transition-colors ${
                  listDensity === "default"
                    ? "bg-surface text-fg"
                    : "text-fg-3 hover:text-fg-2 hover:bg-hover"
                }`}
                title="Default density"
              >
                <Rows3 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setListDensity("condensed")}
                className={`flex items-center gap-1 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.04em] transition-colors border-l border-border ${
                  listDensity === "condensed"
                    ? "bg-surface text-fg"
                    : "text-fg-3 hover:text-fg-2 hover:bg-hover"
                }`}
                title="Condensed density"
              >
                <List className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          <ScanButton />
          <ButtonLink href="/tracker/horizon" variant="secondary">
            <CalendarClock className="w-3.5 h-3.5" />
            Horizon
          </ButtonLink>
          <ButtonLink href="/tracker/new">
            <Sparkles className="w-3.5 h-3.5" />
            New Entry
          </ButtonLink>
        </div>
      </div>

      {/* Filters + search */}
      <FilterBar
        filters={filters}
        onFilterChange={handleFilterChange}
        onClearFilters={handleClearFilters}
        onSearch={setSearch}
        searchValue={search}
      />

      {/* Sort + View controls — only the list view uses the server-side sort.
          Table view has its own column sort; Kanban groups by lifecycle. */}
      {viewMode === "list" && (
      <div className="flex items-center justify-between mt-5">
        <div className="flex items-center gap-2">
          <ArrowUpDown className="w-3.5 h-3.5 text-fg-3" />
          <select
            value={sortField}
            onChange={(e) => { setSortField(e.target.value); setPage(1); }}
            className="bg-transparent border border-border rounded-lg px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.04em] text-fg-2 cursor-pointer focus:outline-none focus:border-accent transition-colors appearance-none pr-7"
            style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%236b7280'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center' }}
          >
            <option value="updated_at">Last Updated</option>
            <option value="impact_score">Impact</option>
            <option value="next_key_date">Next Key Date</option>
            <option value="short_name">Name</option>
            <option value="jurisdiction">Jurisdiction</option>
            <option value="created_at">Date Added</option>
          </select>
          <button
            onClick={() => { setSortOrder((o) => o === "asc" ? "desc" : "asc"); setPage(1); }}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-border font-mono text-[11px] uppercase tracking-[0.04em] text-fg-3 hover:text-fg-2 hover:bg-hover transition-colors"
            title={sortOrder === "asc" ? "Ascending" : "Descending"}
          >
            {sortOrder === "asc" ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />}
            {sortOrder === "asc" ? "Asc" : "Desc"}
          </button>
        </div>
      </div>
      )}

      {/* Results */}
      <div className="mt-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-24">
            <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {viewMode === "list" && (
              <EntriesTable
                entries={data?.entries || []}
                onMutate={() => mutate()}
                viewMode={listDensity}
              />
            )}
            {viewMode === "table" && (
              <EntriesGrid entries={data?.entries || []} />
            )}
            {viewMode === "kanban" && (
              <EntriesKanban entries={data?.entries || []} />
            )}

            {viewMode === "list" && data && data.totalPages > 1 && (
              <div className="flex items-center justify-between mt-6">
                <span className="text-[12px] text-fg-3 tabular-nums">
                  Page {data.page} of {data.totalPages}
                </span>
                <div className="flex gap-1">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="p-2 rounded-lg text-fg-3 hover:text-fg-2 hover:bg-hover disabled:opacity-30 transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
                    disabled={page === data.totalPages}
                    className="p-2 rounded-lg text-fg-3 hover:text-fg-2 hover:bg-hover disabled:opacity-30 transition-colors"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
