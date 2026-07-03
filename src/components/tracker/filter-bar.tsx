"use client";

import { JURISDICTIONS, CATEGORIES, ENTRY_TYPES, STATUSES } from "@/lib/constants";
import { Search, X, Clock } from "lucide-react";
import { useState } from "react";

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
  const hasFilters = Object.values(filters).some((v) => v);
  const [localSearch, setLocalSearch] = useState(searchValue);

  return (
    <div className="space-y-3">
      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-3" />
        <input
          type="text"
          placeholder="Search legislation, regulations, policies..."
          value={localSearch}
          onChange={(e) => {
            setLocalSearch(e.target.value);
            onSearch(e.target.value);
          }}
          className="w-full pl-11 pr-4 py-3 bg-surface border border-border rounded-2xl text-[14px] text-fg placeholder:text-fg-3 focus:outline-none focus:border-border-accent focus:shadow-[var(--shadow-m)] transition-all duration-200"
        />
      </div>

      {/* Filter pills */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Jurisdictions */}
        {JURISDICTIONS.map((j) => {
          const active = filters.jurisdiction?.split(",").includes(j.code);
          return (
            <button
              key={j.code}
              onClick={() => {
                const cur = filters.jurisdiction?.split(",").filter(Boolean) || [];
                const next = active ? cur.filter((c) => c !== j.code) : [...cur, j.code];
                onFilterChange("jurisdiction", next.join(","));
              }}
              className={`px-2.5 py-1 rounded-lg font-mono text-[10px] tracking-[0.04em] uppercase font-medium transition-all duration-150 ${
                active
                  ? "bg-accent text-white"
                  : "text-fg-3 hover:text-fg-2 hover:bg-hover"
              }`}
            >
              {j.flag} {j.code}
            </button>
          );
        })}

        <span className="w-px h-4 bg-border mx-1" />

        <Dropdown
          value={filters.category || ""}
          onChange={(v) => onFilterChange("category", v)}
          placeholder="Category"
          options={CATEGORIES.map((c) => ({ value: c, label: c }))}
        />
        <Dropdown
          value={filters.type || ""}
          onChange={(v) => onFilterChange("type", v)}
          placeholder="Type"
          options={ENTRY_TYPES.map((t) => ({ value: t.value, label: t.label }))}
        />
        <Dropdown
          value={filters.status || ""}
          onChange={(v) => onFilterChange("status", v)}
          placeholder="Status"
          options={STATUSES.map((s) => ({ value: s.value, label: s.label }))}
        />
        <Dropdown
          value={filters.impact_min || ""}
          onChange={(v) => onFilterChange("impact_min", v)}
          placeholder="Impact"
          options={[1, 2, 3, 4, 5].map((i) => ({ value: String(i), label: `${i}+` }))}
        />

        <span className="w-px h-4 bg-border mx-1" />

        <button
          onClick={() =>
            onFilterChange("commencing_soon", filters.commencing_soon === "1" ? "" : "1")
          }
          className={`flex items-center gap-1 px-2.5 py-1 rounded-lg font-mono text-[10px] tracking-[0.04em] uppercase font-medium transition-all duration-150 ${
            filters.commencing_soon === "1"
              ? "bg-accent text-white"
              : "text-fg-3 hover:text-fg-2 hover:bg-hover"
          }`}
          title="Passed legislation commencing in the next 90 days"
        >
          <Clock className="w-3 h-3" />
          Commencing soon
        </button>

        {hasFilters && (
          <button
            onClick={onClearFilters}
            className="flex items-center gap-1 px-2 py-1 font-mono text-[10px] tracking-[0.04em] uppercase text-fg-3 hover:text-fg-2 rounded-lg hover:bg-hover transition-colors"
          >
            <X className="w-3 h-3" />
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

function Dropdown({
  value,
  onChange,
  placeholder,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`px-2.5 py-1 rounded-lg font-mono text-[10px] tracking-[0.04em] uppercase font-medium bg-transparent border-none cursor-pointer focus:outline-none transition-colors ${
        value ? "text-fg" : "text-fg-3 hover:text-fg-2"
      }`}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}
