"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { JurisdictionBadge } from "@/components/ui/jurisdiction-badge";
import { ImpactIndicator } from "@/components/ui/impact-indicator";
import { InstrumentTypeIcon } from "@/components/ui/instrument-type-icon";
import { STATUSES, ENTRY_TYPES, RELATIONSHIP_KINDS } from "@/lib/constants";
import { relativeTime, formatDate } from "@/lib/utils";
import { updateEntry } from "@/hooks/use-entries";
import type { Entry } from "@/lib/types";
import { computeTrustBadges } from "@/lib/trust-badges";
import { Flag, Clock, CornerDownRight, ChevronRight, ArrowUpRight, BookOpen, Replace, Link2, SearchX, GitBranch } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

// Lookups built once per render module-load.
const TYPE_LABEL: Record<string, string> = Object.fromEntries(
  ENTRY_TYPES.map((t) => [t.value, t.label])
);
const KIND_VERB: Record<string, string> = Object.fromEntries(
  RELATIONSHIP_KINDS.map((k) => [k.value, k.verb])
);

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
      <EmptyState
        icon={SearchX}
        title="No entries match your filters"
        description="Try clearing a filter or widening your search to see more of the tracker."
      />
    );
  }

  function renderCondensedRow(entry: Entry, isChild: boolean, hasBorder: boolean) {
    const childCount = entry.children?.length ?? 0;
    const isExpanded = expanded.has(entry.id);
    return (
      <li
        className={`group flex min-h-14 items-center gap-3 py-2 transition-colors duration-150 ${
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
            className="flex items-center gap-1 text-[14px] text-fg-3 truncate flex-shrink min-w-0 max-w-[160px]"
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
        <Link
          href={`/tracker/${entry.id}`}
          className="inline-flex min-h-11 flex-1 min-w-0 items-center truncate text-[15px] font-medium text-fg underline-offset-4 transition-colors duration-150 hover:text-accent-text hover:underline"
        >
          {entry.shortName}
        </Link>
        {entry.flagged && (
          <span className="inline-flex items-center" title="Flagged">
            <Flag className="w-4 h-4 flex-shrink-0" style={{ color: "var(--amber)" }} fill="currentColor" aria-hidden="true" />
            <span className="sr-only">Flagged</span>
          </span>
        )}
        {childCount > 0 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggleExpanded(entry.id);
            }}
            className="flex min-h-11 flex-shrink-0 items-center gap-1.5 rounded-lg bg-hover px-3 text-[14px] font-medium text-fg-3 hover:bg-active hover:text-fg transition-colors"
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
              className="flex-shrink-0 flex items-center gap-1 text-[14px] font-medium"
              style={{ color: "var(--amber-text)" }}
              title={`Commences ${formatDate(entry.nextKeyDate)}`}
            >
              <Clock className="w-2.5 h-2.5" />
              {days}d
            </span>
          );
        })()}
        <span className="text-[14px] text-fg-3 flex-shrink-0">
          {entry.category}
        </span>
        <div className="flex-shrink-0">
          <select
            value={entry.status}
            onChange={(e) => handleStatusChange(entry, e.target.value)}
            aria-label={`Status for ${entry.shortName}`}
            className="min-h-11 cursor-pointer rounded-lg border border-border-hover bg-surface px-3 text-[14px] font-medium text-fg"
            style={{
              color: STATUSES.find((s) => s.value === entry.status)?.color || "var(--fg-3)",
            }}
          >
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
        <span className="text-[14px] text-fg-3 tabular-nums flex-shrink-0">
          {formatDate(entry.nextKeyDate) !== "—" ? formatDate(entry.nextKeyDate) : relativeTime(entry.updatedAt)}
        </span>
      </li>
    );
  }

  function renderDefaultRow(entry: Entry, isChild: boolean, hasBorder: boolean) {
    const childCount = entry.children?.length ?? 0;
    const isExpanded = expanded.has(entry.id);
    return (
      <li
        className={`group flex flex-col gap-4 transition-colors duration-200 sm:flex-row sm:items-start ${
          isChild
            ? `ml-5 border-l-2 border-l-border bg-surface/40 py-4 pl-4 pr-3 sm:ml-10 ${hasBorder ? "border-b border-b-border last:border-b-0" : ""}`
            : "rounded-xl border border-border bg-surface p-4 shadow-[var(--shadow-s)] hover:border-border-hover hover:shadow-[var(--shadow-card)]"
        }`}
      >
        {isChild && (
          <CornerDownRight className="w-4 h-4 flex-shrink-0 mt-1 text-fg-3" />
        )}
        {/* Left: jurisdiction + impact */}
        <div className="flex w-auto flex-shrink-0 items-center gap-3 pt-0.5 sm:w-24 sm:flex-col sm:gap-2">
          <JurisdictionBadge code={entry.jurisdiction} />
          <ImpactIndicator score={entry.impactScore} />
        </div>

        {/* Center: content */}
        <div className="flex-1 min-w-0">
          {/* Typed parent breadcrumb — verb varies by relationship kind. */}
          {entry.parentShortName && (
            <div className="mb-1 flex items-center gap-1 text-[14px] text-fg-3">
              <RelationshipIcon kind={entry.parentRelationshipKind} className="w-3 h-3" />
              <span>
                {entry.parentRelationshipKind && KIND_VERB[entry.parentRelationshipKind]
                  ? KIND_VERB[entry.parentRelationshipKind]
                  : "Part of"}{" "}
                {entry.parentShortName}
              </span>
            </div>
          )}
          {/* Line 1 — the name leads; only a live urgency clock earns a place
              beside it. Everything else is demoted to the meta line below. */}
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <h3 className="min-w-0 text-[17px] font-semibold leading-snug text-fg">
              <Link
                href={`/tracker/${entry.id}`}
                className="inline-flex min-h-11 items-center underline-offset-4 transition-colors duration-150 hover:text-accent-text hover:underline"
              >
                {entry.shortName}
              </Link>
            </h3>
            {entry.flagged && (
              <span className="inline-flex items-center" title="Flagged">
                <Flag className="w-4 h-4 flex-shrink-0" style={{ color: "var(--amber)" }} fill="currentColor" aria-hidden="true" />
                <span className="sr-only">Flagged</span>
              </span>
            )}
            {(() => {
              const days = commencingDays(entry);
              if (days === null) return null;
              return (
                <span
                  className="flex min-h-[30px] flex-shrink-0 items-center gap-1.5 rounded-full bg-amber-bg px-2.5 py-1 text-[14px] font-medium text-amber-text"
                  title={`Commences ${formatDate(entry.nextKeyDate)}`}
                >
                  <Clock className="w-2.5 h-2.5" />
                  Commences in {days}d
                </span>
              );
            })()}
          </div>
          <p className="text-[15px] text-fg-2 leading-relaxed line-clamp-2">
            {entry.summary || entry.fullName}
          </p>
          {/* Satellite activity line (anchor-centric view, §2.2). */}
          {entry.satelliteActivity && (
            <div className="mt-1.5 flex items-center gap-1.5 text-[14px] text-accent-text">
              <GitBranch className="w-3 h-3 flex-shrink-0" />
              <span className="truncate">{entry.satelliteActivity.line}</span>
            </div>
          )}
          {/* Meta line — type, authority, category and regulator read as plain
              text; only "binding" authority keeps a colored emphasis. Trust
              badges and the subordinate-instruments toggle live here too, so
              the title stays uncluttered. */}
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-[14px] text-fg-3">
            <span className="inline-flex items-center gap-1.5">
              <InstrumentTypeIcon type={entry.type} className="w-3.5 h-3.5" title={TYPE_LABEL[entry.type] ?? entry.type} />
              {TYPE_LABEL[entry.type] ?? entry.type}
            </span>
            <span className="opacity-30">·</span>
            <span>{entry.category}</span>
            <span className="opacity-30">·</span>
            <span>{entry.regulator}</span>
            {entry.tags && entry.tags.length > 0 && (
              <>
                <span className="opacity-30">·</span>
                {entry.tags.slice(0, 2).map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-hover px-2.5 py-1 text-[13px] text-fg-2"
                  >
                    {tag}
                  </span>
                ))}
                {entry.tags.length > 2 && (
                  <span className="text-[13px]">+{entry.tags.length - 2}</span>
                )}
              </>
            )}
            {computeTrustBadges(entry).map((badge) => (
              <span
                key={badge.label}
                className={`rounded-full px-2.5 py-1 text-[13px] font-medium ${badge.className}`}
              >
                {badge.label}
              </span>
            ))}
            {childCount > 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleExpanded(entry.id);
                }}
                className="flex min-h-11 items-center gap-1.5 rounded-lg bg-hover px-3 text-[14px] font-medium text-fg-3 hover:bg-active hover:text-fg transition-colors"
                aria-expanded={isExpanded}
                aria-label={`${isExpanded ? "Collapse" : "Expand"} ${childCount} subordinate instrument${childCount === 1 ? "" : "s"}`}
                title={`${childCount} subordinate instrument${childCount === 1 ? "" : "s"}`}
              >
                <ChevronRight className={`w-2.5 h-2.5 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                <span>{childCount} instrument{childCount === 1 ? "" : "s"}</span>
              </button>
            )}
          </div>
        </div>

        {/* Right: status + date */}
        <div className="flex flex-shrink-0 items-center justify-between gap-3 pt-0.5 sm:flex-col sm:items-end">
          <select
            value={entry.status}
            onChange={(e) => handleStatusChange(entry, e.target.value)}
            aria-label={`Status for ${entry.shortName}`}
            className="min-h-11 cursor-pointer rounded-lg border border-border-hover bg-surface px-3 text-[14px] font-medium text-fg"
            style={{
              color: STATUSES.find((s) => s.value === entry.status)?.color || "var(--fg-3)",
            }}
          >
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <span className="text-[14px] text-fg-3 tabular-nums">
            {formatDate(entry.nextKeyDate) !== "—" ? formatDate(entry.nextKeyDate) : relativeTime(entry.updatedAt)}
          </span>
        </div>

      </li>
    );
  }

  if (viewMode === "condensed") {
    return (
      <ul className="stagger" aria-label="Tracker records">
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
      </ul>
    );
  }

  return (
    <ul className="stagger space-y-3" aria-label="Tracker records">
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
    </ul>
  );
}
