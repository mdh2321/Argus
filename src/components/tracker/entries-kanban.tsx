"use client";

import { useRouter } from "next/navigation";
import { JurisdictionBadge } from "@/components/ui/jurisdiction-badge";
import { ImpactIndicator } from "@/components/ui/impact-indicator";
import { STATUSES } from "@/lib/constants";
import { formatDate, relativeTime } from "@/lib/utils";
import type { Entry } from "@/lib/types";
import { Flag, Clock, CornerDownRight, Sparkles, ShieldAlert, Compass, SearchX } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

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
          <div
            key={stage}
            className="flex flex-col rounded-2xl border border-border bg-surface/40 min-h-[280px]"
          >
            {/* Column header */}
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border">
              <div className="flex items-center gap-2 min-w-0">
                <Icon className="w-3.5 h-3.5 flex-shrink-0 text-fg-3" />
                <span className="font-mono text-[11px] uppercase tracking-[0.06em] font-semibold text-fg-2">
                  {label}
                </span>
                <span className="font-mono text-[10px] text-fg-3 tabular-nums">
                  {items.length}
                </span>
              </div>
            </div>
            <p className="px-4 pt-2 pb-1 text-[10px] text-fg-3 leading-snug">
              {description}
            </p>

            {/* Cards */}
            <div className="flex-1 flex flex-col gap-2 p-2">
              {items.length === 0 ? (
                <div className="px-2 py-6 text-center text-[11px] text-fg-3">
                  Nothing here
                </div>
              ) : (
                items.map((entry) => (
                  <KanbanCard key={entry.id} entry={entry} />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function KanbanCard({ entry }: { entry: Entry }) {
  const router = useRouter();
  const statusInfo = STATUSES.find((s) => s.value === entry.status);
  const verb = relationshipVerb(entry.type);

  return (
    <div
      onClick={() => router.push(`/tracker/${entry.id}`)}
      className="group relative cursor-pointer rounded-xl border border-border bg-surface px-3 py-2.5 transition-all duration-150 hover:border-fg-3 hover:shadow-[var(--shadow-card)]"
    >
      {/* Top row: jurisdiction + impact + flag */}
      <div className="flex items-center gap-2 mb-1.5">
        <JurisdictionBadge code={entry.jurisdiction} />
        <ImpactIndicator score={entry.impactScore} />
        {entry.flagged && (
          <Flag
            className="w-3 h-3"
            style={{ color: "var(--amber)" }}
            fill="currentColor"
          />
        )}
      </div>

      {/* Title */}
      <div className="text-[13px] font-medium text-fg group-hover:text-accent transition-colors leading-snug line-clamp-2">
        {entry.shortName}
      </div>

      {/* Parent relationship badge */}
      {entry.parentShortName && (
        <div className="mt-1.5 flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.04em] text-fg-3">
          <CornerDownRight className="w-2.5 h-2.5" />
          <span className="truncate">
            {verb} <span className="text-fg-2">{entry.parentShortName}</span>
          </span>
        </div>
      )}

      {/* Bottom meta: status, next date */}
      <div className="mt-2 flex items-center justify-between gap-2">
        <span
          className="font-mono text-[10px] uppercase tracking-[0.04em] font-medium"
          style={{ color: statusInfo?.color || "var(--fg-3)" }}
        >
          {statusInfo?.label || entry.status}
        </span>
        <div className="flex items-center gap-1 font-mono text-[10px] text-fg-3 tabular-nums">
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
    </div>
  );
}
