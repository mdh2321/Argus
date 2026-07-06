"use client";

import useSWR from "swr";
import Link from "next/link";
import { useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  GitPullRequest,
  AlertCircle,
  FileWarning,
  SearchX,
  Inbox,
} from "lucide-react";

// B1 — "N items need you". A single panel aggregating every pending decision
// so the daily loop is "open Sentinel, clear the queue" rather than hunting
// across surfaces for buttons. Read-only over /api/review-queue.

interface ReviewItem {
  id: string;
  title: string;
  subtitle: string;
  href: string;
}
interface ReviewGroup {
  key: string;
  label: string;
  count: number;
  href: string;
  items: ReviewItem[];
}
interface ReviewQueueResponse {
  total: number;
  groups: ReviewGroup[];
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const GROUP_ICON: Record<string, typeof GitPullRequest> = {
  proposed: GitPullRequest,
  stale: AlertCircle,
  preliminary: FileWarning,
  gaps: SearchX,
};

export function ReviewQueue() {
  const { data } = useSWR<ReviewQueueResponse>("/api/review-queue", fetcher, {
    refreshInterval: 60_000,
  });

  // Nothing to render until we have data — keeps the dashboard from flashing
  // an empty panel on first paint.
  if (!data) return null;

  if (data.total === 0) {
    return (
      <section className="mb-10">
        <div className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3.5">
          <CheckCircle2 className="h-4 w-4 flex-shrink-0" style={{ color: "var(--green)" }} />
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-fg">You&apos;re caught up</div>
            <div className="text-[11px] text-fg-3">No proposals, stale analyses, or gaps need review.</div>
          </div>
          <Inbox className="ml-auto h-4 w-4 text-fg-3" />
        </div>
      </section>
    );
  }

  return (
    <section className="mb-10">
      <div className="mb-3 flex items-center gap-2">
        <Inbox className="h-4 w-4 text-accent" />
        <h2 className="font-mono text-[13px] font-semibold uppercase tracking-[0.04em] text-fg">
          Needs you
        </h2>
        <span className="rounded-full bg-accent/10 px-2 py-0.5 font-mono text-[11px] font-medium text-accent">
          {data.total}
        </span>
      </div>

      <div className="space-y-2">
        {data.groups.map((group) => (
          <ReviewGroupRow key={group.key} group={group} />
        ))}
      </div>
    </section>
  );
}

function ReviewGroupRow({ group }: { group: ReviewGroup }) {
  const [open, setOpen] = useState(false);
  const Icon = GROUP_ICON[group.key] ?? GitPullRequest;

  return (
    <div className="rounded-xl border border-border bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-bg-hover/40 rounded-xl"
      >
        <Icon className="h-4 w-4 flex-shrink-0 text-fg-2" />
        <span className="text-[13px] font-medium text-fg">{group.label}</span>
        <span className="rounded-full bg-bg-hover px-1.5 py-0.5 font-mono text-[10px] font-medium text-fg-2">
          {group.count}
        </span>
        <ChevronDown
          className={`ml-auto h-3.5 w-3.5 text-fg-3 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="border-t border-border/60 px-2 pb-2 pt-1">
          {group.items.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              className="group flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-bg-hover/50"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] font-medium text-fg group-hover:text-accent">
                  {item.title}
                </div>
                <div className="truncate text-[11px] text-fg-3">{item.subtitle}</div>
              </div>
              <ArrowRight className="h-3 w-3 flex-shrink-0 text-fg-3 group-hover:text-accent" />
            </Link>
          ))}
          {group.count > group.items.length && (
            <Link
              href={group.href}
              className="mt-1 flex items-center gap-1 px-2 py-1.5 font-mono text-[11px] text-accent hover:text-accent-2"
            >
              View all {group.count} <ArrowRight className="h-3 w-3" />
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
