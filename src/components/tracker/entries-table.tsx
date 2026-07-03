"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { JurisdictionBadge } from "@/components/ui/jurisdiction-badge";
import { ImpactIndicator } from "@/components/ui/impact-indicator";
import { STATUSES, ENTRY_TYPES, AUTHORITY_LEVELS, TYPE_DEFAULT_AUTHORITY, RELATIONSHIP_KINDS } from "@/lib/constants";
import { relativeTime, formatDate } from "@/lib/utils";
import { updateEntry } from "@/hooks/use-entries";
import type { Entry } from "@/lib/types";
import { computeTrustBadges } from "@/lib/trust-badges";
import { Flag, Clock, CornerDownRight, ChevronRight, ArrowUpRight, BookOpen, Replace, Link2 } from "lucide-react";

// Lookups built once per render module-load.
const TYPE_LABEL: Record<string, string> = Object.fromEntries(
  ENTRY_TYPES.map((t) => [t.value, t.label])
);
const AUTHORITY_BY_VALUE: Record<string, { label: string; color: string }> = Object.fromEntries(
  AUTHORITY_LEVELS.map((a) => [a.value, { label: a.label, color: a.color }])
);
const KIND_VERB: Record<string, string> = Object.fromEntries(
  RELATIONSHIP_KINDS.map((k) => [k.value, k.verb])
);

function authorityFor(entry: Entry): { value: string; label: string; color: string } {
  const value = entry.authorityLevel ?? TYPE_DEFAULT_AUTHORITY[entry.type] ?? "informational";
  const meta = AUTHORITY_BY_VALUE[value] ?? { label: value, color: "var(--fg-3)" };
  return { value, ...meta };
}

// Pick the right icon for a relationship kind. Each verb gets a distinct
// affordance so users can scan the breadcrumb without reading it.
function RelationshipIcon({ kind, className }: { kind: string | null | undefined; className?: string }) {
  switch (kind) {
    case "amends":
      return <ArrowUpRight className={className} />;
    case "interprets":
      return <BookOpen className={className} />;
    case "supersedes":
      return <Replace className={className} />;
    case "implements":
    case "references":
      return <Link2 className={className} />;
    case "subordinate_to":
    default:
      return <CornerDownRight className={className} />;
  }
}

// Returns the days-until value when an entry is `passed` (i.e. enacted but
// not yet in force) and has an upcoming key date. Negative or null → don't
// surface as commencing-soon.
function commencingDays(entry: Entry): number | null {
  if (entry.status !== "passed" || !entry.nextKeyDate) return null;
  const target = new Date(entry.nextKeyDate);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffMs = target.getTime() - today.getTime();
  const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
  return days >= 0 && days <= 90 ? days : null;
}

interface EntriesTableProps {
  entries: Entry[];
  onMutate: () => void;
  viewMode?: "default" | "condensed";
}

export function EntriesTable({
  entries,
  onMutate,
  viewMode = "default",
}: EntriesTableProps) {
  const router = useRouter();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleStatusChange = async (entry: Entry, newStatus: string) => {
    await updateEntry(entry.id, { status: newStatus } as Partial<Entry>);
    onMutate();
  };

  if (entries.length === 0) {
    return (
      <div className="py-20 text-center anim-enter">
        <p className="text-[15px] text-fg-3">No entries match your filters</p>
      </div>
    );
  }

  function renderCondensedRow(entry: Entry, isChild: boolean, hasBorder: boolean) {
    const childCount = entry.children?.length ?? 0;
    const isExpanded = expanded.has(entry.id);
    return (
      <div
        onClick={() => router.push(`/tracker/${entry.id}`)}
        className={`group flex items-center gap-3 py-2 cursor-pointer transition-colors duration-150 ${
          isChild
            ? `ml-10 pl-4 pr-2 border-l border-l-border hover:bg-surface/60 ${hasBorder ? "border-b border-b-border last:border-b-0" : ""}`
            : `-mx-2 px-2 rounded-lg hover:bg-surface hover:border-transparent ${hasBorder ? "border-b border-border last:border-0" : ""}`
        }`}
      >
        {isChild && (
          <CornerDownRight className="w-3.5 h-3.5 flex-shrink-0 text-fg-3" />
        )}
        <JurisdictionBadge code={entry.jurisdiction} />
        <ImpactIndicator score={entry.impactScore} />
        {!isChild && entry.parentShortName && (
          <span
            className="flex items-center gap-1 font-mono text-[10px] tracking-[0.04em] uppercase text-fg-3 truncate flex-shrink min-w-0 max-w-[160px]"
            title={`${
              entry.parentRelationshipKind && KIND_VERB[entry.parentRelationshipKind]
                ? KIND_VERB[entry.parentRelationshipKind]
                : "Part of"
            } ${entry.parentShortName}`}
          >
            <RelationshipIcon kind={entry.parentRelationshipKind} className="w-3 h-3 flex-shrink-0" />
            <span className="truncate">{entry.parentShortName}</span>
          </span>
        )}
        <span className="text-[13px] font-medium text-fg group-hover:text-accent transition-colors duration-150 truncate flex-1 min-w-0">
          {entry.shortName}
        </span>
        {entry.flagged && (
          <Flag className="w-3 h-3 flex-shrink-0" style={{ color: "var(--amber)" }} fill="currentColor" />
        )}
        {childCount > 0 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggleExpanded(entry.id);
            }}
            className="flex-shrink-0 flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5 font-mono text-[9px] font-medium text-fg-3 hover:bg-surface hover:text-fg hover:border-fg-3 transition-colors"
            aria-expanded={isExpanded}
            aria-label={`${isExpanded ? "Collapse" : "Expand"} ${childCount} subordinate instrument${childCount === 1 ? "" : "s"}`}
            title={`${childCount} subordinate instrument${childCount === 1 ? "" : "s"}`}
          >
            <ChevronRight className={`w-2.5 h-2.5 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
            {childCount}
          </button>
        )}
        {(() => {
          const days = commencingDays(entry);
          if (days === null) return null;
          return (
            <span
              className="flex-shrink-0 flex items-center gap-1 font-mono text-[9px] font-medium"
              style={{ color: "var(--amber)" }}
              title={`Commences ${formatDate(entry.nextKeyDate)}`}
            >
              <Clock className="w-2.5 h-2.5" />
              {days}d
            </span>
          );
        })()}
        <span className="font-mono text-[10px] tracking-[0.04em] uppercase text-fg-3 flex-shrink-0">
          {entry.category}
        </span>
        <div className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          <select
            value={entry.status}
            onChange={(e) => handleStatusChange(entry, e.target.value)}
            className="bg-transparent border-none text-[11px] font-medium cursor-pointer focus:outline-none rounded p-0 pr-4 appearance-none text-right"
            style={{
              color: STATUSES.find((s) => s.value === entry.status)?.color || "var(--fg-3)",
            }}
          >
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
        <span className="font-mono text-[10px] tracking-[0.02em] text-fg-3 tabular-nums flex-shrink-0">
          {formatDate(entry.nextKeyDate) !== "—" ? formatDate(entry.nextKeyDate) : relativeTime(entry.updatedAt)}
        </span>
      </div>
    );
  }

  function renderDefaultRow(entry: Entry, isChild: boolean, hasBorder: boolean) {
    const childCount = entry.children?.length ?? 0;
    const isExpanded = expanded.has(entry.id);
    return (
      <div
        onClick={() => router.push(`/tracker/${entry.id}`)}
        className={`group flex items-start gap-4 cursor-pointer transition-colors duration-200 ${
          isChild
            ? `py-3 ml-10 pl-4 pr-2 border-l border-l-border hover:bg-surface/60 ${hasBorder ? "border-b border-b-border last:border-b-0" : ""}`
            : `-mx-2 px-2 py-4 rounded-xl hover:bg-surface hover:shadow-[var(--shadow-card)] hover:border-transparent ${hasBorder ? "border-b border-border last:border-0" : ""}`
        }`}
      >
        {isChild && (
          <CornerDownRight className="w-4 h-4 flex-shrink-0 mt-1 text-fg-3" />
        )}
        {/* Left: jurisdiction + impact */}
        <div className="flex flex-col items-center gap-2 pt-0.5 w-12 flex-shrink-0">
          <JurisdictionBadge code={entry.jurisdiction} />
          <ImpactIndicator score={entry.impactScore} />
        </div>

        {/* Center: content */}
        <div className="flex-1 min-w-0">
          {/* Typed parent breadcrumb — verb varies by relationship kind. */}
          {entry.parentShortName && (
            <div className="flex items-center gap-1 mb-1 font-mono text-[10px] tracking-[0.04em] uppercase text-fg-3">
              <RelationshipIcon kind={entry.parentRelationshipKind} className="w-3 h-3" />
              <span>
                {entry.parentRelationshipKind && KIND_VERB[entry.parentRelationshipKind]
                  ? KIND_VERB[entry.parentRelationshipKind]
                  : "Part of"}{" "}
                {entry.parentShortName}
              </span>
            </div>
          )}
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[14px] font-medium text-fg group-hover:text-accent transition-colors duration-150 truncate">
              {entry.shortName}
            </span>
            {entry.flagged && (
              <Flag className="w-3 h-3 flex-shrink-0" style={{ color: "var(--amber)" }} fill="currentColor" />
            )}
            {/* Type chip */}
            <span className="rounded-full border border-border px-1.5 py-0.5 font-mono text-[9px] font-medium tracking-[0.04em] uppercase text-fg-3">
              {TYPE_LABEL[entry.type] ?? entry.type}
            </span>
            {/* Authority indicator — solid for binding, outline for expected,
                ghost for interpretive, muted dot for informational. */}
            {(() => {
              const a = authorityFor(entry);
              const base = "rounded-full font-mono text-[9px] font-medium tracking-[0.04em] uppercase";
              if (a.value === "binding") {
                return (
                  <span
                    className={`${base} px-1.5 py-0.5 text-white`}
                    style={{ background: a.color }}
                    title={`Authority: ${a.label}`}
                  >
                    {a.label}
                  </span>
                );
              }
              if (a.value === "expected") {
                return (
                  <span
                    className={`${base} border px-1.5 py-0.5`}
                    style={{ color: a.color, borderColor: a.color }}
                    title={`Authority: ${a.label}`}
                  >
                    {a.label}
                  </span>
                );
              }
              if (a.value === "interpretive") {
                return (
                  <span
                    className={`${base} px-1.5 py-0.5`}
                    style={{ color: a.color }}
                    title={`Authority: ${a.label}`}
                  >
                    {a.label}
                  </span>
                );
              }
              return (
                <span
                  className={`${base} px-1.5 py-0.5 text-fg-3`}
                  title={`Authority: ${a.label}`}
                >
                  {a.label}
                </span>
              );
            })()}
            {computeTrustBadges(entry).map((badge) => (
              <span
                key={badge.label}
                className={`rounded-full border px-1.5 py-0.5 font-mono text-[9px] font-medium ${badge.className}`}
              >
                {badge.label}
              </span>
            ))}
            {(() => {
              const days = commencingDays(entry);
              if (days === null) return null;
              return (
                <span
                  className="flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-mono text-[9px] font-medium"
                  style={{ color: "var(--amber)", borderColor: "var(--amber)" }}
                  title={`Commences ${formatDate(entry.nextKeyDate)}`}
                >
                  <Clock className="w-2.5 h-2.5" />
                  Commences in {days}d
                </span>
              );
            })()}
            {childCount > 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleExpanded(entry.id);
                }}
                className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 font-mono text-[9px] font-medium text-fg-3 hover:bg-surface hover:text-fg hover:border-fg-3 transition-colors"
                aria-expanded={isExpanded}
                aria-label={`${isExpanded ? "Collapse" : "Expand"} ${childCount} subordinate instrument${childCount === 1 ? "" : "s"}`}
                title={`${childCount} subordinate instrument${childCount === 1 ? "" : "s"}`}
              >
                <ChevronRight className={`w-2.5 h-2.5 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                <span>{childCount} subordinate</span>
              </button>
            )}
          </div>
          <p className="text-[12px] text-fg-3 leading-relaxed line-clamp-2">
            {entry.summary || entry.fullName}
          </p>
          {/* Meta row */}
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            <span className="font-mono text-[10px] tracking-[0.04em] uppercase text-fg-3">{entry.category}</span>
            <span className="text-fg-3 opacity-30">·</span>
            <span className="font-mono text-[10px] tracking-[0.04em] uppercase text-fg-3">
              {entry.regulator}
            </span>
            {entry.tags && entry.tags.length > 0 && (
              <>
                <span className="text-fg-3 opacity-30">·</span>
                {entry.tags.slice(0, 3).map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-accent-bg px-2 py-0.5 font-mono text-[9px] text-accent"
                  >
                    {tag}
                  </span>
                ))}
                {entry.tags.length > 3 && (
                  <span className="font-mono text-[9px] text-fg-3">+{entry.tags.length - 3}</span>
                )}
              </>
            )}
          </div>
        </div>

        {/* Right: status + date */}
        <div className="flex flex-col items-end gap-2 flex-shrink-0 pt-0.5" onClick={(e) => e.stopPropagation()}>
          <select
            value={entry.status}
            onChange={(e) => handleStatusChange(entry, e.target.value)}
            className={`bg-transparent border-none text-[11px] font-medium cursor-pointer focus:outline-none rounded p-0 pr-4 appearance-none text-right`}
            style={{
              color: STATUSES.find((s) => s.value === entry.status)?.color || "var(--fg-3)",
            }}
          >
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <span className="font-mono text-[10px] tracking-[0.02em] text-fg-3 tabular-nums">
            {formatDate(entry.nextKeyDate) !== "—" ? formatDate(entry.nextKeyDate) : relativeTime(entry.updatedAt)}
          </span>
        </div>

      </div>
    );
  }

  if (viewMode === "condensed") {
    return (
      <div className="stagger">
        {entries.map((entry) => {
          const kids = entry.children ?? [];
          const showKids = expanded.has(entry.id) && kids.length > 0;
          const last = kids.length - 1;
          return (
            <Fragment key={entry.id}>
              {renderCondensedRow(entry, false, !showKids)}
              {showKids && kids.map((child, i) => (
                <Fragment key={child.id}>
                  {renderCondensedRow(child, true, i === last)}
                </Fragment>
              ))}
            </Fragment>
          );
        })}
      </div>
    );
  }

  return (
    <div className="stagger">
      {entries.map((entry) => {
        const kids = entry.children ?? [];
        const showKids = expanded.has(entry.id) && kids.length > 0;
        const last = kids.length - 1;
        return (
          <Fragment key={entry.id}>
            {renderDefaultRow(entry, false, !showKids)}
            {showKids && kids.map((child, i) => (
              <Fragment key={child.id}>
                {renderDefaultRow(child, true, i === last)}
              </Fragment>
            ))}
          </Fragment>
        );
      })}
    </div>
  );
}
