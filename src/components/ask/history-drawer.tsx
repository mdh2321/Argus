"use client";

import { useEffect, useState } from "react";
import { Trash2, LoaderCircle, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { SidePanel } from "@/components/shared/side-panel";
import { relativeTime } from "@/lib/utils";

interface SessionSummary {
  id: string;
  updatedAt: string;
  title: string;
  turns: number;
}

interface HistoryDrawerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
  /** The session currently loaded in the page, highlighted in the list. */
  activeId: string | null;
}

export function HistoryDrawer({ open, onClose, onSelect, activeId }: HistoryDrawerProps) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    fetch("/api/ask/sessions")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        if (!cancelled) setSessions(data.sessions ?? []);
      })
      .catch(() => {
        if (!cancelled) toast.error("Couldn't load history");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function deleteSession(id: string) {
    if (!confirm("Delete this conversation? This can't be undone.")) return;
    setDeleting(id);
    try {
      const res = await fetch(`/api/ask/sessions/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete failed");
      setSessions((prev) => prev.filter((s) => s.id !== id));
      toast.success("Conversation deleted");
    } catch {
      toast.error("Couldn't delete that conversation");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <SidePanel open={open} onClose={onClose} title="Conversations" description="Pick up where you left off.">
      <div>
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-[16px] text-fg-3">
              <LoaderCircle className="h-4 w-4 animate-spin text-accent" />
              Loading…
            </div>
          ) : sessions.length === 0 ? (
            <div className="px-4 py-12 text-center text-[16px] text-fg-3">
              No past conversations yet.
            </div>
          ) : (
            <ul className="space-y-1">
              {sessions.map((s) => (
                <li key={s.id}>
                  <div
                    className={`group flex items-start gap-2 rounded-lg px-4 py-4 transition-colors hover:bg-hover ${
                      s.id === activeId ? "bg-hover" : ""
                    }`}
                  >
                    <button
                      onClick={() => onSelect(s.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="truncate text-[16px] text-fg-2 group-hover:text-fg">
                        {s.title}
                      </div>
                      <div className="mt-1 flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.04em] text-fg-3">
                        <span>{relativeTime(s.updatedAt)}</span>
                        <span className="inline-flex items-center gap-1">
                          <MessageSquare className="h-3 w-3" />
                          {s.turns}
                        </span>
                      </div>
                    </button>
                    <button
                      onClick={() => void deleteSession(s.id)}
                      disabled={deleting === s.id}
                      className="rounded-md p-1.5 text-fg-3 opacity-0 transition-all hover:bg-red-bg hover:text-red group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-50"
                      aria-label="Delete conversation"
                    >
                      {deleting === s.id ? (
                        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
      </div>
    </SidePanel>
  );
}
