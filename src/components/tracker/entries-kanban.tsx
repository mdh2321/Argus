"use client";

import Link from "next/link";
import { JurisdictionBadge } from "@/components/ui/jurisdiction-badge";
import { ImpactIndicator } from "@/components/ui/impact-indicator";
import { formatDate, relativeTime } from "@/lib/utils";
import type { Entry } from "@/lib/types";
import { Flag, Clock, CornerDownRight, Sparkles, ShieldAlert, Compass, SearchX } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";

type LifecycleStage = "horizon" | "active" | "archive";

const STAGE_FOR_STATUS: Record<string, LifecycleStage> = {
  monitoring: "horizon",
  proposed: "horizon",
  consultation: "horizon",
  bill_introduced: "horizon",
  passed: "active",
  in_force: "active",
  amended: "active",
  enforcement: "active",
  repealed: "archive",
};

const COLUMNS: { stage: LifecycleStage; label: string; description: string; Icon: typeof Compass }[] = [
  {
    stage: "horizon",
    label: "Horizon",
    description: "Proposed, in consultation, or pre-enactment",
    Icon: Compass,
  },
  {
    stage: "active",
    label: "Active",
    description: "In force, recently amended, or under enforcement",
    Icon: Sparkles,
  },
  {
    stage: "archive",
    label: "Archive",
    description: "Repealed or superseded",
    Icon: ShieldAlert,
  },
];

// Pick a verb for the parent-relationship badge based on the entry's type.
// (`relationshipType` doesn't exist on entries yet — derive from `type`.)
function relationshipVerb(type: string): string {
  switch (type) {
    case "bill":
      return "amends";
    case "regulation":
    case "binding-guidance":
    case "interpretive-guidance":
    case "policy":
      return "under";
    case "enforcement":
    case "court-decision":
      return "enforces";
    case "consultation":
      return "proposes change to";
    default:
      return "related to";
  }
}

// Flatten parent + children into one list. Each row keeps a reference to the
// parent's shortName so the relationship badge can render inline.
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

interface EntriesKanbanProps {
  entries: Entry[];
}

export function EntriesKanban({ entries }: EntriesKanbanProps) {
  const flat = flattenWithParents(entries);

  if (flat.length === 0) {
    return (
      <EmptyState
        icon={SearchX}
        title="No entries match your filters"
        description="Try clearing a filter or widening your search to see more of the tracker."
      />
    );
  }

  const grouped: Record<LifecycleStage, Entry[]> = {
    horizon: [],
    active: [],
    archive: [],
  };

  for (const e of flat) {
    const stage = STAGE_FOR_STATUS[e.status] ?? "active";
    grouped[stage].push(e);
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 anim-enter">
      {COLUMNS.map(({ stage, label, description, Icon }) => {
        const items = grouped[stage];
        return (
          <section
            key={stage}
            className="flex flex-col rounded-2xl border border-border bg-surface/40 min-h-[280px]"
          >
            {/* Column header */}
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border">
              <div className="flex items-center gap-2 min-w-0">
                <Icon className="w-3.5 h-3.5 flex-shrink-0 text-fg-3" />
                <h2 className="text-[16px] font-semibold text-fg-2">
                  {label}
                </h2>
                <span className="inline-grid h-7 min-w-7 place-items-center rounded-full border border-border px-1 text-[14px] text-fg-3 tabular-nums">
                  <span className="sr-only">Records: </span>{items.length}
                </span>
              </div>
            </div>
            <p className="px-4 pt-3 pb-1 text-[14px] text-fg-3 leading-snug">
              {description}
            </p>

            {/* Cards */}
            <ul className="flex-1 flex flex-col gap-2 p-2">
              {items.length === 0 ? (
                <li className="px-2 py-6 text-center text-[14px] text-fg-3">
                  Nothing here
                </li>
              ) : (
                items.map((entry) => (
                  <li key={entry.id}>
                    <KanbanCard entry={entry} />
                  </li>
                ))
              )}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function KanbanCard({ entry }: { entry: Entry }) {
  const verb = relationshipVerb(entry.type);

  return (
    <Link
      href={`/tracker/${entry.id}`}
      className="group relative block min-h-11 rounded-xl border border-border bg-surface p-4 transition-all duration-150 hover:border-border-hover hover:shadow-[var(--shadow-card)]"
    >
      {/* Top row: jurisdiction + impact + flag */}
      <div className="flex items-center gap-2 mb-1.5">
        <JurisdictionBadge code={entry.jurisdiction} />
        <ImpactIndicator score={entry.impactScore} />
        {entry.flagged && (
          <span className="inline-flex items-center" title="Flagged">
            <Flag
              className="w-4 h-4"
              style={{ color: "var(--amber)" }}
              fill="currentColor"
              aria-hidden="true"
            />
            <span className="sr-only">Flagged</span>
          </span>
        )}
      </div>

      {/* Title */}
      <h3 className="text-[16px] font-semibold text-fg group-hover:text-accent-text transition-colors leading-snug line-clamp-2">
        {entry.shortName}
      </h3>

      {/* Parent relationship badge */}
      {entry.parentShortName && (
        <div className="mt-2 flex items-center gap-1.5 text-[14px] text-fg-3">
          <CornerDownRight className="w-2.5 h-2.5" />
          <span className="truncate">
            {verb} <span className="text-fg-2">{entry.parentShortName}</span>
          </span>
        </div>
      )}

      {/* Bottom meta: status, next date */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <StatusBadge status={entry.status} />
        <div className="flex items-center gap-1.5 text-[14px] text-fg-3 tabular-nums">
          {entry.nextKeyDate ? (
            <>
              <Clock className="w-2.5 h-2.5" />
              {formatDate(entry.nextKeyDate)}
            </>
          ) : (
            <span>{relativeTime(entry.updatedAt)}</span>
          )}
        </div>
      </div>
    </Link>
  );
}
