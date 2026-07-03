"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { JurisdictionBadge } from "@/components/ui/jurisdiction-badge";
import { ImpactIndicator } from "@/components/ui/impact-indicator";
import { STATUSES, ENTRY_TYPES } from "@/lib/constants";
import { formatDate, relativeTime } from "@/lib/utils";
import type { Entry } from "@/lib/types";
import { Flag, ArrowUp, ArrowDown } from "lucide-react";

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
  const router = useRouter();
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
      <div className="py-20 text-center anim-enter">
        <p className="text-[15px] text-fg-3">No entries match your filters</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border anim-enter">
      <table className="w-full text-[12px]">
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
            const statusInfo = STATUSES.find((s) => s.value === entry.status);
            return (
              <tr
                key={entry.id}
                onClick={() => router.push(`/tracker/${entry.id}`)}
                className="border-b border-border last:border-b-0 cursor-pointer transition-colors hover:bg-hover"
              >
                <td className="px-3 py-2.5 font-mono text-[10px] uppercase tracking-[0.04em] text-fg-3 whitespace-nowrap">
                  {typeLabel(entry.type)}
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  <JurisdictionBadge code={entry.jurisdiction} />
                </td>
                <td className="px-3 py-2.5 max-w-[320px]">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-fg truncate">{entry.shortName}</span>
                    {entry.flagged && (
                      <Flag
                        className="w-3 h-3 flex-shrink-0"
                        style={{ color: "var(--amber)" }}
                        fill="currentColor"
                      />
                    )}
                  </div>
                </td>
                <td className="px-3 py-2.5 max-w-[200px]">
                  {entry.parentShortName ? (
                    <span className="text-fg-3 truncate block" title={entry.parentShortName}>
                      {entry.parentShortName}
                    </span>
                  ) : (
                    <span className="text-fg-3 opacity-30">—</span>
                  )}
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  <span
                    className="font-mono text-[10px] uppercase tracking-[0.04em] font-medium"
                    style={{ color: statusInfo?.color || "var(--fg-3)" }}
                  >
                    {statusInfo?.label || entry.status}
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex justify-center">
                    <ImpactIndicator score={entry.impactScore} />
                  </div>
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-[11px] text-fg-3 tabular-nums whitespace-nowrap">
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
      onClick={() => onSort(sortKey)}
      className={`px-3 py-2.5 font-mono text-[10px] uppercase tracking-[0.06em] font-semibold cursor-pointer select-none transition-colors hover:text-fg ${alignClass} ${
        active ? "text-fg" : "text-fg-3"
      }`}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active &&
          (dir === "asc" ? (
            <ArrowUp className="w-3 h-3" />
          ) : (
            <ArrowDown className="w-3 h-3" />
          ))}
      </span>
    </th>
  );
}
