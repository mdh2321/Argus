"use client";

import { useEffect, useState } from "react";
import { Clock, Trash2, X, LoaderCircle, MessageSquare } from "lucide-react";
import { toast } from "sonner";
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

  // Close on Escape while open.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

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

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100]">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed right-0 top-0 flex h-full w-full max-w-sm flex-col border-l border-border bg-surface shadow-[var(--shadow-l)]">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3.5">
          <Clock className="h-4 w-4 text-accent" />
          <h2 className="text-[14px] font-semibold text-fg">History</h2>
          <button
            onClick={onClose}
            className="ml-auto rounded-lg p-1.5 text-fg-3 transition-colors hover:bg-hover hover:text-fg-2"
            aria-label="Close history"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-[13px] text-fg-3">
              <LoaderCircle className="h-4 w-4 animate-spin text-accent" />
              Loading…
            </div>
          ) : sessions.length === 0 ? (
            <div className="px-4 py-12 text-center text-[13px] text-fg-3">
              No past conversations yet.
            </div>
          ) : (
            <ul className="space-y-1">
              {sessions.map((s) => (
                <li key={s.id}>
                  <div
                    className={`group flex items-start gap-2 rounded-lg px-3 py-2.5 transition-colors hover:bg-hover ${
                      s.id === activeId ? "bg-hover" : ""
                    }`}
                  >
                    <button
                      onClick={() => onSelect(s.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="truncate text-[13px] text-fg-2 group-hover:text-fg">
                        {s.title}
                      </div>
                      <div className="mt-1 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.04em] text-fg-3">
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
                      className="rounded-md p-1.5 text-fg-3 opacity-0 transition-all hover:bg-red-bg hover:text-red group-hover:opacity-100 disabled:opacity-50"
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
      </div>
    </div>
  );
}
