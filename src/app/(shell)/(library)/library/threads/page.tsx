"use client";

import Link from "next/link";
import useSWR from "swr";
import { relativeTime } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { MessagesSquare, ArrowRight } from "lucide-react";

interface SessionSummary {
  id: string;
  updatedAt: string;
  title: string;
  turns: number;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

// Ask conversations as first-class Library citizens — past research threads
// browsable alongside topics and the shelf, not buried in a transient drawer.
export default function ThreadsPage() {
  const { data, isLoading } = useSWR<{ sessions: SessionSummary[] }>("/api/ask/sessions", fetcher);
  const sessions = data?.sessions ?? [];

  return (
    <div className="anim-enter mx-auto max-w-3xl">
      <div className="mb-6 flex items-center gap-2">
        <MessagesSquare className="h-4 w-4 text-accent" />
        <h1 className="font-mono text-[15px] font-semibold uppercase tracking-[0.04em] text-fg">
          Research threads
        </h1>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      ) : sessions.length === 0 ? (
        <EmptyState
          icon={MessagesSquare}
          title="No threads yet"
          description="Conversations you have with Ask Sentinel are saved here — pick one up where you left off, any time."
        />
      ) : (
        <div className="space-y-2 stagger">
          {sessions.map((s) => (
            <Link
              key={s.id}
              href={`/ask?session=${s.id}`}
              className="group flex items-center gap-3 rounded-xl bg-surface p-4 shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-card-hover)]"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium text-fg group-hover:text-accent transition-colors">
                  {s.title}
                </p>
                <p className="mt-0.5 font-mono text-[11px] text-fg-3">
                  {s.turns} turn{s.turns === 1 ? "" : "s"} · {relativeTime(s.updatedAt)}
                </p>
              </div>
              <ArrowRight className="h-4 w-4 flex-shrink-0 text-fg-3 transition-colors group-hover:text-accent" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
