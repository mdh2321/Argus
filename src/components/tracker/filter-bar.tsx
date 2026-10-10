"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Search, SlidersHorizontal, X } from "lucide-react";
import {
  CATEGORIES,
  ENTRY_TYPES,
  ENTRY_TYPE_GROUPS,
  JURISDICTIONS,
  STATUSES,
} from "@/lib/constants";

interface FilterBarProps {
  filters: Record<string, string>;
  onFilterChange: (key: string, value: string) => void;
  onClearFilters: () => void;
  onSearch: (query: string) => void;
  searchValue: string;
}

export function FilterBar({
  filters,
  onFilterChange,
  onClearFilters,
  onSearch,
  searchValue,
}: FilterBarProps) {
  const [localSearch, setLocalSearch] = useState(searchValue);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeCount = Object.values(filters).filter(Boolean).length;
  const selectedJurisdictions = useMemo(
    () => filters.jurisdiction?.split(",").filter(Boolean) ?? [],
    [filters.jurisdiction]
  );
  const hasFilters = Boolean(localSearch.trim() || Object.values(filters).some(Boolean));

  useEffect(() => {
    setLocalSearch(searchValue);
  }, [searchValue]);

  const jurisdictionLabel =
    selectedJurisdictions.length === 0
      ? "All jurisdictions"
      : selectedJurisdictions.length <= 2
        ? selectedJurisdictions.join(", ")
        : `${selectedJurisdictions.length} selected`;

  return (
    <section aria-label="Search and filter legislation" className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[180px] flex-1">
          <label htmlFor="tracker-search" className="mb-2 block text-[12px] font-medium text-fg-3">
            Search legislation
          </label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-3"
              aria-hidden="true"
            />
            <input
              id="tracker-search"
              type="search"
              placeholder="Title, regulator, topic, or jurisdiction"
              autoComplete="off"
              value={localSearch}
              onChange={(event) => {
                setLocalSearch(event.target.value);
                onSearch(event.target.value);
              }}
              className="min-h-11 w-full rounded-xl border border-border bg-bg pl-9 pr-3 text-[14px] text-fg placeholder:text-fg-3"
            />
          </div>
        </div>

        <button
          type="button"
          aria-expanded={filtersOpen}
          aria-controls="tracker-filters"
          onClick={() => setFiltersOpen((open) => !open)}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border px-4 text-[14px] text-fg-2 hover:bg-hover"
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
          Filters{activeCount > 0 ? ` · ${activeCount}` : ""}
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${filtersOpen ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>
        {hasFilters && (
          <button type="button" onClick={onClearFilters} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-[13px] text-fg-3 hover:bg-hover hover:text-fg">
            <X className="h-3.5 w-3.5" aria-hidden="true" /> Clear all
          </button>
        )}
      </div>
      <div id="tracker-filters" hidden={!filtersOpen}>
        <div className="mt-5 grid items-end gap-4 border-t border-border pt-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <div className="relative">
            <span className="mb-2 block text-[12px] font-medium text-fg-3">Jurisdiction</span>
            <details className="group relative">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-xl border border-border bg-bg px-3 text-[14px] text-fg marker:content-none">
                <span className="truncate">{jurisdictionLabel}</span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-fg-3 transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <div className="absolute left-0 top-[calc(100%+6px)] z-30 w-[320px] max-w-[calc(100vw-5rem)] rounded-xl border border-border bg-surface p-2 shadow-[var(--shadow-l)]">
                <div className="grid grid-cols-2 gap-1">
                  {JURISDICTIONS.map((jurisdiction) => {
                    const selected = selectedJurisdictions.includes(jurisdiction.code);
                    return (
                      <label
                        key={jurisdiction.code}
                        className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 text-[12px] text-fg-2 hover:bg-hover hover:text-fg"
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => {
                            const next = selected
                              ? selectedJurisdictions.filter((code) => code !== jurisdiction.code)
                              : [...selectedJurisdictions, jurisdiction.code];
                            onFilterChange("jurisdiction", next.join(","));
                          }}
                          className="peer sr-only"
                        />
                        <span
                          className={`grid h-4 w-4 shrink-0 place-items-center rounded border peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus ${
                            selected ? "border-accent bg-accent text-white" : "border-border-hover"
                          }`}
                          aria-hidden="true"
                        >
                          {selected && <Check className="h-3 w-3" />}
                        </span>
                        <span aria-hidden="true">{jurisdiction.flag}</span>
                        <span className="truncate">{jurisdiction.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </details>
          </div>

          <Dropdown
            id="tracker-topic-filter"
            value={filters.category || ""}
            onChange={(value) => onFilterChange("category", value)}
            label="Topic"
            allLabel="All topics"
            options={CATEGORIES.map((category) => ({ value: category, label: category }))}
          />

          <Dropdown
            id="tracker-type-filter"
            value={filters.type || ""}
            onChange={(value) => onFilterChange("type", value)}
            label="Type"
            allLabel="All types"
            groups={ENTRY_TYPE_GROUPS.map((group) => ({
              label: group.label,
              options: group.types.map((value) => ({
                value,
                label: ENTRY_TYPES.find((type) => type.value === value)?.label ?? value,
              })),
            }))}
          />

          <Dropdown
            id="tracker-status-filter"
            value={filters.status || ""}
            onChange={(value) => onFilterChange("status", value)}
            label="Status"
            allLabel="All statuses"
            options={STATUSES.map((status) => ({ value: status.value, label: status.label }))}
          />

          <Dropdown
            id="tracker-impact-filter"
            value={filters.impact_min || ""}
            onChange={(value) => onFilterChange("impact_min", value)}
            label="Impact"
            allLabel="Any impact"
            options={[1, 2, 3, 4, 5].map((score) => ({
              value: String(score),
              label: score === 5 ? "5 only" : `${score} or higher`,
            }))}
          />

        </div>
      </div>
    </section>
  );
}

function Dropdown({
  id,
  value,
  onChange,
  label,
  allLabel,
  options,
  groups,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  label: string;
  allLabel: string;
  options?: { value: string; label: string }[];
  groups?: { label: string; options: { value: string; label: string }[] }[];
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-2 block text-[12px] font-medium text-fg-3">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-11 w-full rounded-xl border border-border bg-bg px-3 text-[14px] text-fg"
      >
        <option value="">{allLabel}</option>
        {options?.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
        {groups?.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
