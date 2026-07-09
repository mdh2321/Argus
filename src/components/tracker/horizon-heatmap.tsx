"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { JURISDICTIONS } from "@/lib/constants";
import { getFlag } from "@/lib/digest-utils";
import { formatDate } from "@/lib/utils";
import type { HorizonItem } from "@/lib/types";

// A jurisdiction × quarter weather-map of what's landing. Reuses the Horizon
// list's own items, so it's a bird's-eye read of the same data: cell intensity
// = how much is landing there, a ring = at least one high-impact item, and
// hovering a cell synthesises what it contains. Reads at a glance where the
// regulatory pressure is building.

const HIGH_IMPACT = 4;

function quarterKey(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${Math.floor(d.getMonth() / 3) + 1}`;
}
function quarterLabel(key: string): string {
  const [y, q] = key.split("-");
  return `Q${q} '${y.slice(2)}`;
}

interface Cell {
  items: HorizonItem[];
  high: number;
}

export function HorizonHeatmap({ items }: { items: HorizonItem[] }) {
  const router = useRouter();
  const [hover, setHover] = useState<string | null>(null);

  const { quarters, jurRows, grid, max } = useMemo(() => {
    const qSet = new Set<string>();
    const jSet = new Set<string>();
    const grid = new Map<string, Cell>();
    let max = 0;
    for (const it of items) {
      const q = quarterKey(it.date);
      qSet.add(q);
      jSet.add(it.jurisdiction);
      const key = `${it.jurisdiction}|${q}`;
      const cell = grid.get(key) ?? { items: [], high: 0 };
      cell.items.push(it);
      if ((it.impactScore ?? 0) >= HIGH_IMPACT) cell.high += 1;
      grid.set(key, cell);
      if (cell.items.length > max) max = cell.items.length;
    }
    const quarters = [...qSet].sort().slice(0, 6);
    // Keep jurisdiction rows in the canonical order, only those with items.
    const jurRows = JURISDICTIONS.map((j) => j.code).filter((c) => jSet.has(c));
    return { quarters, jurRows, grid, max };
  }, [items]);

  if (jurRows.length === 0 || quarters.length === 0) return null;

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-baseline gap-2.5">
        <h2 className="label-mono">Where it&apos;s landing</h2>
        <span className="text-[12px] text-fg-3">Upcoming activity by jurisdiction &amp; quarter — hover a cell</span>
      </div>
      <div className="overflow-x-auto rounded-xl bg-surface p-4 shadow-[var(--shadow-card)]">
        <div
          className="grid gap-1.5"
          style={{ gridTemplateColumns: `2.5rem repeat(${quarters.length}, minmax(56px, 1fr))` }}
        >
          {/* Header row */}
          <span />
          {quarters.map((q) => (
            <span key={q} className="pb-1 text-center font-mono text-[10px] uppercase tracking-[0.04em] text-fg-3">
              {quarterLabel(q)}
            </span>
          ))}

          {/* Rows */}
          {jurRows.map((code) => (
            <RowCells
              key={code}
              code={code}
              quarters={quarters}
              grid={grid}
              max={max}
              hover={hover}
              setHover={setHover}
              onOpen={(entryId) => router.push(`/tracker/${entryId}`)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function RowCells({
  code,
  quarters,
  grid,
  max,
  hover,
  setHover,
  onOpen,
}: {
  code: string;
  quarters: string[];
  grid: Map<string, Cell>;
  max: number;
  hover: string | null;
  setHover: (k: string | null) => void;
  onOpen: (entryId: string) => void;
}) {
  return (
    <>
      <span className="flex items-center gap-1 font-mono text-[11px] text-fg-3">
        <span className="text-[13px] leading-none">{getFlag(code)}</span>
        {code}
      </span>
      {quarters.map((q) => {
        const key = `${code}|${q}`;
        const cell = grid.get(key);
        const count = cell?.items.length ?? 0;
        const intensity = count === 0 ? 0 : 0.15 + (count / max) * 0.7;
        const isHover = hover === key;
        return (
          <div key={q} className="relative">
            <div
              onMouseEnter={() => setHover(key)}
              onMouseLeave={() => setHover(null)}
              className={`h-9 rounded-md transition-all ${count > 0 ? "cursor-default" : ""}`}
              style={{
                background:
                  count === 0
                    ? "var(--bg-hover)"
                    : `color-mix(in srgb, var(--accent) ${Math.round(intensity * 100)}%, transparent)`,
                boxShadow: cell && cell.high > 0 ? "inset 0 0 0 1.5px var(--red)" : undefined,
              }}
            >
              {count > 0 && (
                <span className="flex h-full items-center justify-center text-[11px] font-semibold tabular-nums text-fg">
                  {count}
                </span>
              )}
            </div>
            {isHover && cell && (
              <div className="absolute top-full left-1/2 z-30 mt-1.5 w-64 -translate-x-1/2 rounded-xl border border-border bg-surface p-3 shadow-[var(--shadow-l)]">
                <div className="mb-1.5 flex items-baseline justify-between">
                  <span className="font-mono text-[10px] uppercase tracking-[0.04em] text-fg-2">
                    {getFlag(code)} {code} · {quarterLabel(q)}
                  </span>
                  <span className="font-mono text-[10px] text-fg-3">
                    {count} landing{cell.high > 0 ? ` · ${cell.high} high` : ""}
                  </span>
                </div>
                <div className="space-y-1">
                  {cell.items.slice(0, 4).map((it) => (
                    <button
                      key={it.id}
                      onClick={() => onOpen(it.entryId)}
                      className="flex w-full items-baseline justify-between gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-hover"
                    >
                      <span className="min-w-0 truncate text-[12px] text-fg-2">{it.shortName}</span>
                      <span className="flex-shrink-0 font-mono text-[10px] text-fg-3 tabular-nums">
                        {formatDate(it.date)}
                      </span>
                    </button>
                  ))}
                  {cell.items.length > 4 && (
                    <div className="px-1.5 pt-0.5 font-mono text-[10px] text-fg-3">
                      +{cell.items.length - 4} more
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
