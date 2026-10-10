"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { JurisdictionBadge } from "@/components/ui/jurisdiction-badge";
import { ImpactIndicator } from "@/components/ui/impact-indicator";
import { InstrumentTypeIcon } from "@/components/ui/instrument-type-icon";
import { ENTRY_TYPES } from "@/lib/constants";
import { formatDate, relativeTime } from "@/lib/utils";
import type { Entry } from "@/lib/types";
import { Flag, ArrowUp, ArrowDown, SearchX } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";

type SortKey = "type" | "jurisdiction" | "name" | "parent" | "status" | "impact" | "next";
type SortDir = "asc" | "desc";

function flattenWithParents(entries: Entry[]): Entry[] {
  const out: Entry[] = [];
  for (const e of entries) {
    out.push(e);
    for (const child of e.children ?? []) {
      out.push({ ...child, parentShortName: child.parentShortName ?? e.shortName });
    }
  }
  return out;
}

function typeLabel(value: string): string {
  return ENTRY_TYPES.find((t) => t.value === value)?.label ?? value;
}

function compareValues(a: unknown, b: unknown, dir: SortDir): number {
  const flip = dir === "asc" ? 1 : -1;
  if (a == null && b == null) return 0;
  if (a == null) return 1; // nulls last regardless of direction
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") {
    return (a - b) * flip;
  }
  return String(a).localeCompare(String(b)) * flip;
}

interface EntriesGridProps {
  entries: Entry[];
}

export function EntriesGrid({ entries }: EntriesGridProps) {
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const rows = useMemo(() => {
    const flat = flattenWithParents(entries);
    const accessor: Record<SortKey, (e: Entry) => unknown> = {
      type: (e) => e.type,
      jurisdiction: (e) => e.jurisdiction,
      name: (e) => e.shortName,
      parent: (e) => e.parentShortName ?? "",
      status: (e) => e.status,
      impact: (e) => e.impactScore,
      next: (e) => e.nextKeyDate,
    };
    return [...flat].sort((a, b) => compareValues(accessor[sortKey](a), accessor[sortKey](b), sortDir));
  }, [entries, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={SearchX}
        title="No entries match your filters"
        description="Try clearing a filter or widening your search to see more of the tracker."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border anim-enter">
      <table className="w-full text-[14px]">
        <caption className="sr-only">Tracker records. Use the column buttons to change sorting.</caption>
        <thead className="bg-surface/60 border-b border-border">
          <tr>
            <Th label="Type" sortKey="type" current={sortKey} dir={sortDir} onSort={handleSort} />
            <Th label="Juris." sortKey="jurisdiction" current={sortKey} dir={sortDir} onSort={handleSort} />
            <Th label="Name" sortKey="name" current={sortKey} dir={sortDir} onSort={handleSort} />
            <Th label="Parent" sortKey="parent" current={sortKey} dir={sortDir} onSort={handleSort} />
            <Th label="Status" sortKey="status" current={sortKey} dir={sortDir} onSort={handleSort} />
            <Th label="Impact" sortKey="impact" current={sortKey} dir={sortDir} onSort={handleSort} align="center" />
            <Th label="Next Date" sortKey="next" current={sortKey} dir={sortDir} onSort={handleSort} align="right" />
          </tr>
        </thead>
        <tbody>
          {rows.map((entry) => {
            return (
              <tr key={entry.id} className="border-b border-border last:border-b-0 transition-colors hover:bg-hover">
                <td className="px-3 py-3 text-[14px] text-fg-3 whitespace-nowrap">
                  <span className="inline-flex items-center gap-1.5">
                    <InstrumentTypeIcon type={entry.type} className="w-3.5 h-3.5" title={typeLabel(entry.type)} />
                    {typeLabel(entry.type)}
                  </span>
                </td>
                <td className="px-3 py-3 whitespace-nowrap">
                  <JurisdictionBadge code={entry.jurisdiction} />
                </td>
                <td className="px-3 py-3 max-w-[320px]">
                  <div className="flex items-center gap-1.5">
                    <Link
                      href={`/tracker/${entry.id}`}
                      className="inline-flex min-h-11 items-center truncate font-medium text-fg underline-offset-4 hover:text-accent-text hover:underline"
                    >
                      {entry.shortName}
                    </Link>
                    {entry.flagged && (
                      <span className="inline-flex items-center" title="Flagged">
                        <Flag
                          className="w-4 h-4 flex-shrink-0"
                          style={{ color: "var(--amber)" }}
                          fill="currentColor"
                          aria-hidden="true"
                        />
                        <span className="sr-only">Flagged</span>
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-3 max-w-[200px]">
                  {entry.parentShortName ? (
                    <span className="text-fg-3 truncate block" title={entry.parentShortName}>
                      {entry.parentShortName}
                    </span>
                  ) : (
                    <span className="text-fg-3 opacity-30">—</span>
                  )}
                </td>
                <td className="px-3 py-3 whitespace-nowrap">
                  <StatusBadge status={entry.status} />
                </td>
                <td className="px-3 py-3">
                  <div className="flex justify-center">
                    <ImpactIndicator score={entry.impactScore} />
                  </div>
                </td>
                <td className="px-3 py-3 text-right text-[14px] text-fg-3 tabular-nums whitespace-nowrap">
                  {entry.nextKeyDate ? formatDate(entry.nextKeyDate) : relativeTime(entry.updatedAt)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Th({
  label,
  sortKey,
  current,
  dir,
  onSort,
  align = "left",
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  dir: SortDir;
  onSort: (k: SortKey) => void;
  align?: "left" | "center" | "right";
}) {
  const active = current === sortKey;
  const alignClass =
    align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
  return (
    <th
      scope="col"
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
      className={`px-3 py-1 text-[14px] font-semibold ${alignClass} ${
        active ? "text-fg" : "text-fg-3"
      }`}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex min-h-11 items-center gap-1 rounded-md px-1 transition-colors hover:bg-hover hover:text-fg"
      >
        {label}
        {active &&
          (dir === "asc" ? (
            <ArrowUp className="w-3 h-3" />
          ) : (
            <ArrowDown className="w-3 h-3" />
          ))}
      </button>
    </th>
  );
}
